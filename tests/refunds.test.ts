import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { refundsApp } from "@/apps/refunds/manifest";
import { createPayment } from "@/apps/refunds/payments";
import { refundResource } from "@/apps/refunds/permissions";
import { paymentPiiResolver } from "@/apps/refunds/pii";
import { buildRefundWhere } from "@/apps/refunds/queries";
import { refundApprovalRule } from "@/apps/refunds/rules";
import { decideRefund, OVER_REFUND_MESSAGE, requestRefund, syncDecidedRefunds } from "@/apps/refunds/service";
import { registeredApps } from "@/platform/apps/registry";
import { getApprovalRule } from "@/platform/approvals/registry";
import { decideApproval, SELF_APPROVAL_MESSAGE } from "@/platform/approvals/service";
import { SYSTEM_ACTOR } from "@/platform/audit/types";
import { DEMO_USERS } from "@/platform/auth/demo-users";
import { provisionUser } from "@/platform/auth/users";
import { prisma } from "@/platform/db";
import { AuthorizationError, ConflictError } from "@/platform/errors";
import { getPiiResolver } from "@/platform/pii/registry";
import { can } from "@/platform/rbac/policy";
import { ROLES, type Role } from "@/platform/rbac/roles";
import type { AuthUser } from "@/platform/rbac/types";
import { buildNavigation } from "@/platform/ui/navigation";
import { createUser, fakeUser } from "./helpers";

let counter = 0;
async function payment(amountMinor = 100_000, status: "succeeded" | "pending" | "failed" = "succeeded") {
  counter += 1;
  return createPayment(SYSTEM_ACTOR, {
    reference: `PAY-${String(900_000 + counter).padStart(6, "0")}`,
    customerName: "Jane Customer",
    amountMinor,
    currency: "EUR",
    status,
  });
}

async function pendingRefund(requester: AuthUser, amountMinor = 60_000) {
  const p = await payment(100_000);
  const result = await requestRefund(requester, { paymentId: p.id, amountMinor, reason: "Item arrived damaged" });
  if (!result.approvalRequest) throw new Error("expected an approval request");
  return { payment: p, ...result, approvalRequest: result.approvalRequest };
}

let operator: AuthUser;
let approver: AuthUser;
let lead: AuthUser;

beforeAll(async () => {
  operator = await createUser("operator");
  approver = await createUser("approver");
  const demoLead = DEMO_USERS.find((u) => u.email === "lead@demo.local")!;
  lead = await provisionUser(SYSTEM_ACTOR, { email: demoLead.email, name: demoLead.name, roles: demoLead.roles });
});

describe("registration", () => {
  it("is registered with the platform (nav, approval rule, PII resolver)", () => {
    expect(registeredApps).toContain(refundsApp);
    expect(getApprovalRule(refundApprovalRule.key)).toBe(refundApprovalRule);
    expect(getPiiResolver("Payment")).toBe(paymentPiiResolver);
    const nav = buildNavigation(fakeUser("viewer")).find((s) => s.title === "Refunds");
    expect(nav?.items.map((i) => i.href)).toEqual(["/refunds", "/refunds/payments"]);
  });
});

describe("authorization: role matrix", () => {
  const EXPECTED: Record<Role, string[]> = {
    viewer: ["payment:read", "refund:read"],
    operator: ["payment:read", "refund:read", "refund:create"],
    approver: ["payment:read", "refund:read", "refund:decide"],
    admin: ["payment:read", "refund:read", "refund:create", "refund:decide"],
  };
  const ALL = ["payment:read", "refund:read", "refund:create", "refund:decide"];
  for (const role of ROLES) {
    for (const permission of ALL) {
      const allowed = EXPECTED[role].includes(permission);
      it(`${role} is ${allowed ? "allowed" : "denied"} ${permission}`, () => {
        const [type, action] = permission.split(":") as [string, string];
        expect(can(fakeUser(role), action, { type, attributes: { requestedById: "someone-else" } })).toBe(allowed);
      });
    }
  }

  it("denies anonymous users and users without roles", () => {
    expect(can(null, "read", { type: "refund" })).toBe(false);
    expect(can(fakeUser(), "read", { type: "refund" })).toBe(false);
  });

  it("four-eyes resource policy denies deciding your own refund, even as admin", () => {
    const admin = fakeUser("admin");
    expect(can(admin, "decide", refundResource({ id: "r1", requestedById: admin.id }))).toBe(false);
    expect(can(admin, "decide", refundResource({ id: "r1", requestedById: "other" }))).toBe(true);
    expect(can(admin, "decide", { type: "refund" })).toBe(false);
  });

  it("viewer and approver cannot request refunds (server-side)", async () => {
    const p = await payment();
    for (const role of ["viewer", "approver"] as const) {
      const user = await createUser(role);
      await expect(requestRefund(user, { paymentId: p.id, amountMinor: 1_000, reason: "Test" })).rejects.toBeInstanceOf(AuthorizationError);
    }
    expect(await prisma.refund.count({ where: { paymentId: p.id } })).toBe(0);
  });

  it("viewer and operator cannot decide refunds (server-side)", async () => {
    const { refund } = await pendingRefund(operator);
    for (const role of ["viewer", "operator"] as const) {
      const user = await createUser(role);
      await expect(decideRefund(user, { refundId: refund.id, decision: "approve" })).rejects.toBeInstanceOf(AuthorizationError);
    }
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe("requested");
  });
});

describe("auto-approve threshold (500.00 EUR)", () => {
  it("rule: <= 50000 cents is auto-approved, 50001 needs approval, unknown currency fails safe", () => {
    expect(refundApprovalRule.requiresApproval({ amountMinor: 1, currency: "EUR" })).toBe(false);
    expect(refundApprovalRule.requiresApproval({ amountMinor: 50_000, currency: "EUR" })).toBe(false);
    expect(refundApprovalRule.requiresApproval({ amountMinor: 50_001, currency: "EUR" })).toBe(true);
    expect(refundApprovalRule.requiresApproval({ amountMinor: 100, currency: "USD" })).toBe(true);
  });

  it("auto-approves exactly 500.00 EUR without an approval request", async () => {
    const p = await payment(80_000);
    const { refund, approvalRequest } = await requestRefund(operator, { paymentId: p.id, amountMinor: 50_000, reason: "Customer returned the goods" });
    expect(approvalRequest).toBeNull();
    expect(refund).toMatchObject({ status: "auto_approved", requestedById: operator.id, decidedByEmail: "system", currency: "EUR" });
    expect(refund.decidedAt).toBeInstanceOf(Date);
    expect(await prisma.approvalRequest.count({ where: { entityType: "Refund", entityId: refund.id } })).toBe(0);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).refundedMinor).toBe(50_000);
  });

  it("500.01 EUR creates a pending platform approval request", async () => {
    const p = await payment(80_000);
    const { refund, approvalRequest } = await requestRefund(operator, { paymentId: p.id, amountMinor: 50_001, reason: "Duplicate charge" });
    expect(refund.status).toBe("requested");
    expect(refund.decidedAt).toBeNull();
    expect(approvalRequest).toMatchObject({
      ruleKey: refundApprovalRule.key,
      entityType: "Refund",
      entityId: refund.id,
      status: "pending",
      requesterId: operator.id,
      amountMinor: 50_001,
      currency: "EUR",
    });
  });
});

describe("over-refund protection", () => {
  it("blocks a single refund above the payment amount", async () => {
    const p = await payment(10_000);
    await expect(requestRefund(operator, { paymentId: p.id, amountMinor: 10_001, reason: "Too much" })).rejects.toThrow(OVER_REFUND_MESSAGE);
    expect(await prisma.refund.count({ where: { paymentId: p.id } })).toBe(0);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).refundedMinor).toBe(0);
  });

  it("blocks cumulative refunds above the payment amount, counting pending ones", async () => {
    const p = await payment(100_000);
    await requestRefund(operator, { paymentId: p.id, amountMinor: 40_000, reason: "Partial 1" });
    await requestRefund(operator, { paymentId: p.id, amountMinor: 55_000, reason: "Partial 2 (pending approval)" });
    await expect(requestRefund(operator, { paymentId: p.id, amountMinor: 5_001, reason: "Partial 3" })).rejects.toBeInstanceOf(ConflictError);
    const ok = await requestRefund(operator, { paymentId: p.id, amountMinor: 5_000, reason: "Exactly the rest" });
    expect(ok.refund.status).toBe("auto_approved");
    await expect(requestRefund(operator, { paymentId: p.id, amountMinor: 1, reason: "One cent more" })).rejects.toThrow(OVER_REFUND_MESSAGE);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).refundedMinor).toBe(100_000);
  });

  it("is atomic under concurrent requests", async () => {
    const p = await payment(30_000);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => requestRefund(operator, { paymentId: p.id, amountMinor: 10_000, reason: "Concurrent" })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    const stored = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(stored.refundedMinor).toBe(30_000);
    expect(await prisma.refund.count({ where: { paymentId: p.id } })).toBe(3);
  });

  it("a declined refund releases its amount", async () => {
    const { payment: p, refund } = await pendingRefund(operator, 100_000);
    await expect(requestRefund(operator, { paymentId: p.id, amountMinor: 1, reason: "More" })).rejects.toThrow(OVER_REFUND_MESSAGE);
    await decideRefund(approver, { refundId: refund.id, decision: "decline", reason: "Not eligible" });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).refundedMinor).toBe(0);
    const again = await requestRefund(operator, { paymentId: p.id, amountMinor: 20_000, reason: "Smaller refund" });
    expect(again.refund.status).toBe("auto_approved");
  });

  it("rejects non-succeeded payments and invalid amounts", async () => {
    const failed = await payment(10_000, "failed");
    await expect(requestRefund(operator, { paymentId: failed.id, amountMinor: 100, reason: "Nope" })).rejects.toBeInstanceOf(ConflictError);
    const p = await payment(10_000);
    await expect(requestRefund(operator, { paymentId: p.id, amountMinor: 0, reason: "Zero" })).rejects.toThrow();
    await expect(requestRefund(operator, { paymentId: p.id, amountMinor: 10.5, reason: "Float" })).rejects.toThrow();
    await expect(requestRefund(operator, { paymentId: p.id, amountMinor: 100, reason: "" })).rejects.toThrow();
  });
});

describe("approving and declining", () => {
  it("a different approver approves; refund and approval request are both updated", async () => {
    const { refund, approvalRequest, payment: p } = await pendingRefund(operator);
    const approved = await decideRefund(approver, { refundId: refund.id, decision: "approve", reason: "Looks right" });
    expect(approved).toMatchObject({ status: "approved", decidedById: approver.id, decidedByEmail: approver.email, decisionReason: "Looks right" });
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approvalRequest.id } })).status).toBe("approved");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).refundedMinor).toBe(60_000);
    await expect(decideRefund(await createUser("approver"), { refundId: refund.id, decision: "decline", reason: "late" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("declining requires a reason", async () => {
    const { refund } = await pendingRefund(operator);
    await expect(decideRefund(approver, { refundId: refund.id, decision: "decline", reason: "" })).rejects.toThrow();
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe("requested");
  });

  it("auto-approved refunds cannot be decided", async () => {
    const p = await payment(10_000);
    const { refund } = await requestRefund(operator, { paymentId: p.id, amountMinor: 1_000, reason: "Small" });
    await expect(decideRefund(approver, { refundId: refund.id, decision: "decline", reason: "x" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("decisions made on the generic approvals page are synced to the refund", async () => {
    const { refund, approvalRequest, payment: p } = await pendingRefund(operator);
    await decideApproval(approver, { requestId: approvalRequest.id, decision: "decline", reason: "Declined in approvals" });
    expect(await syncDecidedRefunds([refund.id])).toBe(1);
    expect(await syncDecidedRefunds([refund.id])).toBe(0);
    const stored = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(stored).toMatchObject({ status: "declined", decidedById: approver.id, decisionReason: "Declined in approvals" });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p.id } })).refundedMinor).toBe(0);
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { entityType: "Refund", entityId: refund.id, action: "refund.decline" } });
    expect(event.actorEmail).toBe("system");
  });
});

describe("four-eyes: self-approval blocked for lead@demo.local", () => {
  it("lead (operator + approver) cannot approve or decline their own refund request", async () => {
    expect(lead.email).toBe("lead@demo.local");
    expect(lead.roles).toEqual(expect.arrayContaining(["operator", "approver"]));
    const { refund, approvalRequest } = await pendingRefund(lead);
    await expect(decideRefund(lead, { refundId: refund.id, decision: "approve" })).rejects.toThrow(SELF_APPROVAL_MESSAGE);
    await expect(decideRefund(lead, { refundId: refund.id, decision: "decline", reason: "x" })).rejects.toThrow(SELF_APPROVAL_MESSAGE);
    // The generic approvals module blocks it too.
    await expect(decideApproval(lead, { requestId: approvalRequest.id, decision: "approve" })).rejects.toThrow(SELF_APPROVAL_MESSAGE);
    await syncDecidedRefunds([refund.id]);

    const stored = await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(stored).toMatchObject({ status: "requested", decidedById: null });
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approvalRequest.id } })).status).toBe("pending");
    expect(await prisma.auditEvent.count({ where: { entityId: refund.id, action: "refund.self_approval_blocked" } })).toBe(2);
    expect(await prisma.auditEvent.count({ where: { entityId: approvalRequest.id, action: "approval.self_approval_blocked" } })).toBe(1);
    expect(await prisma.auditEvent.count({ where: { entityId: refund.id, action: { in: ["refund.approve", "refund.decline"] } } })).toBe(0);

    // Another approver can still decide it, and lead can approve other people's refunds.
    await decideRefund(approver, { refundId: refund.id, decision: "approve" });
    const other = await pendingRefund(operator);
    await expect(decideRefund(lead, { refundId: other.refund.id, decision: "approve" })).resolves.toMatchObject({ status: "approved", decidedById: lead.id });
  });
});

describe("audit events", () => {
  it("payment creation is audited with the customer name masked", async () => {
    const p = await payment();
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { entityType: "Payment", entityId: p.id, action: "payment.create" } });
    expect(event.actorEmail).toBe("system");
    expect(event.after).not.toContain("Jane Customer");
    expect(JSON.parse(event.after!)).toMatchObject({ reference: p.reference, amountMinor: p.amountMinor });
  });

  it("refund request + reservation are audited in the same transaction", async () => {
    const p = await payment(20_000);
    const { refund } = await requestRefund(operator, { paymentId: p.id, amountMinor: 5_000, reason: "Audited" });
    const created = await prisma.auditEvent.findFirstOrThrow({ where: { entityType: "Refund", entityId: refund.id, action: "refund.request" } });
    expect(created).toMatchObject({ actorId: operator.id, before: null });
    expect(JSON.parse(created.after!)).toMatchObject({ status: "auto_approved", amountMinor: 5_000 });
    expect(JSON.parse(created.metadata!)).toMatchObject({ autoApproved: true });
    const reserved = await prisma.auditEvent.findFirstOrThrow({ where: { entityType: "Payment", entityId: p.id, action: "payment.refund_reserved" } });
    expect(JSON.parse(reserved.before!)).toEqual({ refundedMinor: 0 });
    expect(JSON.parse(reserved.after!)).toEqual({ refundedMinor: 5_000 });
    expect(JSON.parse(reserved.metadata!)).toMatchObject({ refundId: refund.id });
    // No PII anywhere in the refund's events.
    const all = await prisma.auditEvent.findMany({ where: { OR: [{ entityId: refund.id }, { entityId: p.id }] } });
    for (const event of all) expect(JSON.stringify(event)).not.toContain("Jane Customer");
  });

  it("approve, decline and release are audited with before/after", async () => {
    const first = await pendingRefund(operator);
    await decideRefund(approver, { refundId: first.refund.id, decision: "approve" });
    const approve = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: first.refund.id, action: "refund.approve" } });
    expect(approve.actorId).toBe(approver.id);
    expect(JSON.parse(approve.before!)).toMatchObject({ status: "requested" });
    expect(JSON.parse(approve.after!)).toMatchObject({ status: "approved", decidedById: approver.id });
    expect(await prisma.auditEvent.count({ where: { entityId: first.approvalRequest.id, action: "approval.approve" } })).toBe(1);

    const second = await pendingRefund(operator);
    await decideRefund(approver, { refundId: second.refund.id, decision: "decline", reason: "No" });
    expect(await prisma.auditEvent.count({ where: { entityId: second.refund.id, action: "refund.decline" } })).toBe(1);
    const release = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: second.payment.id, action: "payment.refund_released" } });
    expect(JSON.parse(release.after!)).toEqual({ refundedMinor: 0 });
  });

  it("failed requests write no refund events", async () => {
    const p = await payment(1_000);
    const before = await prisma.auditEvent.count();
    await expect(requestRefund(operator, { paymentId: p.id, amountMinor: 2_000, reason: "Over" })).rejects.toThrow();
    expect(await prisma.auditEvent.count()).toBe(before);
  });
});

describe("list filters", () => {
  it("builds status, amount range and UTC date filters; ignores invalid values", () => {
    expect(buildRefundWhere({ status: "requested", min: "500.00", max: "1000", from: "2026-01-01", to: "2026-01-31" })).toEqual({
      status: "requested",
      amountMinor: { gte: 50_000, lte: 100_000 },
      createdAt: { gte: new Date("2026-01-01T00:00:00.000Z"), lte: new Date("2026-01-31T23:59:59.999Z") },
    });
    expect(buildRefundWhere({ min: "abc", from: "yesterday" })).toEqual({});
  });
});

describe("PII", () => {
  it("resolver returns the customer name only for the known field", async () => {
    const p = await payment();
    expect(await paymentPiiResolver.resolve(p.id, "customerName")).toBe("Jane Customer");
    expect(await paymentPiiResolver.resolve(p.id, "reference")).toBeNull();
    expect(await paymentPiiResolver.resolve(randomUUID(), "customerName")).toBeNull();
  });
});
