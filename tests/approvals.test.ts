import { describe, expect, it } from "vitest";
import { amountThresholdRule, demoPaymentRule } from "@/platform/approvals/rules";
import { decideApproval, requestApproval, SELF_APPROVAL_MESSAGE, type RequestApprovalInput } from "@/platform/approvals/service";
import { canTransition } from "@/platform/approvals/status";
import { prisma } from "@/platform/db";
import { AuthorizationError, ConflictError } from "@/platform/errors";
import { createUser } from "./helpers";

let counter = 0;
function input(amountMinor = 250_000, currency = "EUR"): RequestApprovalInput {
  counter += 1;
  return {
    ruleKey: demoPaymentRule.key,
    entityType: demoPaymentRule.entityType,
    entityId: `test-${Date.now()}-${counter}`,
    summary: "Test payment",
    amountMinor,
    currency,
    payload: { beneficiaryName: "Jane Doe", beneficiaryIban: "DE89370400440532013000" },
  };
}

async function pendingRequest() {
  const operator = await createUser("operator");
  const result = await requestApproval(operator, input());
  if (!result.required) throw new Error("expected approval to be required");
  return { operator, request: result.request };
}

describe("threshold rules", () => {
  const rule = amountThresholdRule({ key: "t", description: "t", entityType: "T", thresholdsMinor: { EUR: 100_000 } });

  it("requires approval at or above the threshold", () => {
    expect(rule.requiresApproval({ amountMinor: 99_999, currency: "EUR" })).toBe(false);
    expect(rule.requiresApproval({ amountMinor: 100_000, currency: "EUR" })).toBe(true);
    expect(rule.requiresApproval({ amountMinor: 5_000_000, currency: "eur" })).toBe(true);
  });

  it("fails safe for unknown currencies or missing amounts", () => {
    expect(rule.requiresApproval({ amountMinor: 1, currency: "CHF" })).toBe(true);
    expect(rule.requiresApproval({ amountMinor: null, currency: "EUR" })).toBe(true);
    expect(rule.requiresApproval({})).toBe(true);
  });

  it("rejects non-integer thresholds (money is integer minor units)", () => {
    expect(() => amountThresholdRule({ key: "x", description: "x", entityType: "X", thresholdsMinor: { EUR: 10.5 } })).toThrow();
  });

  it("does not create a request below the threshold", async () => {
    const operator = await createUser("operator");
    const before = await prisma.approvalRequest.count();
    expect(await requestApproval(operator, input(99_999))).toEqual({ required: false });
    expect(await prisma.approvalRequest.count()).toBe(before);
  });

  it("canTransition only allows leaving pending", () => {
    expect(canTransition("pending", "approved")).toBe(true);
    expect(canTransition("pending", "declined")).toBe(true);
    expect(canTransition("approved", "declined")).toBe(false);
    expect(canTransition("declined", "approved")).toBe(false);
    expect(canTransition("bogus", "approved")).toBe(false);
  });
});

describe("requesting approval", () => {
  it("creates a pending request and an audit event", async () => {
    const { operator, request } = await pendingRequest();
    expect(request).toMatchObject({ status: "pending", requesterId: operator.id, amountMinor: 250_000, currency: "EUR" });
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: request.id, action: "approval.request" } });
    expect(event.actorId).toBe(operator.id);
    expect(event.before).toBeNull();
    expect(JSON.parse(event.after!)).toMatchObject({ status: "pending" });
    // PII in the payload is masked in the audit snapshot.
    expect(event.after).not.toContain("Jane Doe");
    expect(event.after).not.toContain("DE89370400440532013000");
  });

  it("is denied for viewer and approver-only users", async () => {
    for (const role of ["viewer", "approver"] as const) {
      const user = await createUser(role);
      await expect(requestApproval(user, input())).rejects.toBeInstanceOf(AuthorizationError);
    }
  });

  it("validates input on the server", async () => {
    const operator = await createUser("operator");
    await expect(requestApproval(operator, { ...input(), amountMinor: 10.5 })).rejects.toThrow();
    await expect(requestApproval(operator, { ...input(), currency: "euro" })).rejects.toThrow();
  });
});

describe("deciding approval requests", () => {
  it("lets a different approver approve, with before/after audited", async () => {
    const { request } = await pendingRequest();
    const approver = await createUser("approver");
    const approved = await decideApproval(approver, { requestId: request.id, decision: "approve" });
    expect(approved).toMatchObject({ status: "approved", deciderId: approver.id });
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: request.id, action: "approval.approve" } });
    expect(event.actorId).toBe(approver.id);
    expect(JSON.parse(event.before!)).toMatchObject({ status: "pending" });
    expect(JSON.parse(event.after!)).toMatchObject({ status: "approved", deciderId: approver.id });
  });

  it("lets a different approver decline with a reason, audited", async () => {
    const { request } = await pendingRequest();
    const approver = await createUser("approver");
    await expect(decideApproval(approver, { requestId: request.id, decision: "decline", reason: "" })).rejects.toThrow();
    const declined = await decideApproval(approver, { requestId: request.id, decision: "decline", reason: "Duplicate" });
    expect(declined).toMatchObject({ status: "declined", decisionReason: "Duplicate" });
    expect(await prisma.auditEvent.count({ where: { entityId: request.id, action: "approval.decline" } })).toBe(1);
  });

  it("blocks self-approval for a user who is both operator and approver", async () => {
    const lead = await createUser("operator", "approver");
    const result = await requestApproval(lead, input());
    if (!result.required) throw new Error("expected approval");
    await expect(decideApproval(lead, { requestId: result.request.id, decision: "approve" })).rejects.toThrow(SELF_APPROVAL_MESSAGE);
    await expect(decideApproval(lead, { requestId: result.request.id, decision: "decline", reason: "x" })).rejects.toThrow(SELF_APPROVAL_MESSAGE);
    const stored = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: result.request.id } });
    expect(stored.status).toBe("pending");
    expect(stored.deciderId).toBeNull();
    // Blocked attempts are audited; no approve/decline event exists.
    expect(await prisma.auditEvent.count({ where: { entityId: stored.id, action: "approval.self_approval_blocked" } })).toBe(2);
    expect(await prisma.auditEvent.count({ where: { entityId: stored.id, action: { in: ["approval.approve", "approval.decline"] } } })).toBe(0);
  });

  it("blocks self-approval for admins too", async () => {
    const admin = await createUser("admin");
    const result = await requestApproval(admin, input());
    if (!result.required) throw new Error("expected approval");
    await expect(decideApproval(admin, { requestId: result.request.id, decision: "approve" })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("denies viewers and operators", async () => {
    const { request } = await pendingRequest();
    for (const role of ["viewer", "operator"] as const) {
      const user = await createUser(role);
      await expect(decideApproval(user, { requestId: request.id, decision: "approve" })).rejects.toBeInstanceOf(AuthorizationError);
    }
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("pending");
  });

  it("cannot decide a request twice", async () => {
    const { request } = await pendingRequest();
    const first = await createUser("approver");
    const second = await createUser("approver");
    await decideApproval(first, { requestId: request.id, decision: "approve" });
    await expect(decideApproval(second, { requestId: request.id, decision: "decline", reason: "late" })).rejects.toBeInstanceOf(ConflictError);
    expect(await prisma.auditEvent.count({ where: { entityId: request.id, action: { startsWith: "approval.decl" } } })).toBe(0);
  });
});
