import { beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { kycApp } from "@/apps/kyc/manifest";
import { kycCasePiiResolver } from "@/apps/kyc/pii";
import { buildKycWhere, UNASSIGNED } from "@/apps/kyc/queries";
import { kycHighRiskApprovalRule } from "@/apps/kyc/rules";
import {
  AWAITING_APPROVAL_MESSAGE,
  claimKycCase,
  confirmKycApproval,
  createKycCase,
  decideKycCase,
  NOT_ASSIGNED_MESSAGE,
  syncDecidedKycCases,
} from "@/apps/kyc/service";
import { canTransition, KYC_STATUSES } from "@/apps/kyc/status";
import { registeredApps } from "@/platform/apps/registry";
import { getApprovalRule } from "@/platform/approvals/registry";
import { decideApproval, SELF_APPROVAL_MESSAGE } from "@/platform/approvals/service";
import { SYSTEM_ACTOR } from "@/platform/audit/types";
import { DEMO_USERS } from "@/platform/auth/demo-users";
import { findAuthUserByEmail, provisionUser } from "@/platform/auth/users";
import { prisma } from "@/platform/db";
import { AuthorizationError, ConflictError } from "@/platform/errors";
import { getPiiResolver } from "@/platform/pii/registry";
import { revealPII } from "@/platform/pii/reveal";
import { can } from "@/platform/rbac/policy";
import { ROLES, type Role } from "@/platform/rbac/roles";
import type { AuthUser } from "@/platform/rbac/types";
import { buildNavigation } from "@/platform/ui/navigation";
import { createUser, fakeUser } from "./helpers";

const CUSTOMER_NAME = "Jane Customer";
const DOCUMENT_NUMBER = "C01X00T47";

let counter = 0;
async function newCase(riskScore = 30) {
  counter += 1;
  return createKycCase(SYSTEM_ACTOR, {
    reference: `KYC-${String(900_000 + counter).padStart(6, "0")}`,
    customerName: CUSTOMER_NAME,
    dateOfBirth: "1985-04-12",
    documentType: "passport",
    documentNumber: DOCUMENT_NUMBER,
    country: "de",
    riskScore,
  });
}

async function claimedCase(analyst: AuthUser, riskScore = 30) {
  const c = await newCase(riskScore);
  await claimKycCase(analyst, { caseId: c.id });
  return c;
}

/** A high-risk case the analyst approved, now waiting for a second approver. */
async function awaitingConfirmation(analyst: AuthUser) {
  const c = await claimedCase(analyst, 85);
  const result = await decideKycCase(analyst, { caseId: c.id, decision: "approve", reason: "Documents verified" });
  if (!result.approvalRequest) throw new Error("expected an approval request");
  return { kycCase: result.kycCase, approvalRequest: result.approvalRequest };
}

async function caseActions(caseId: string) {
  const events = await prisma.auditEvent.findMany({ where: { entityType: "KycCase", entityId: caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return events;
}

let operator: AuthUser;
let otherOperator: AuthUser;
let approver: AuthUser;
let viewer: AuthUser;
let admin: AuthUser;
let lead: AuthUser;

beforeAll(async () => {
  operator = await createUser("operator");
  otherOperator = await createUser("operator");
  approver = await createUser("approver");
  viewer = await createUser("viewer");
  admin = await createUser("admin");
  const demoLead = DEMO_USERS.find((u) => u.email === "lead@demo.local")!;
  // Other test files provision lead@demo.local too (shared test database).
  lead =
    (await findAuthUserByEmail(demoLead.email)) ??
    (await provisionUser(SYSTEM_ACTOR, { email: demoLead.email, name: demoLead.name, roles: demoLead.roles }));
});

describe("registration", () => {
  it("is registered once with nav, approval rule and PII resolver", () => {
    expect(registeredApps.filter((a) => a.id === "kyc")).toEqual([kycApp]);
    expect(getApprovalRule(kycHighRiskApprovalRule.key)).toBe(kycHighRiskApprovalRule);
    expect(getPiiResolver("KycCase")).toBe(kycCasePiiResolver);
    const sections = buildNavigation(fakeUser("viewer")).filter((s) => s.title === "KYC Review Queue");
    expect(sections).toHaveLength(1);
    expect(sections[0]!.items.map((i) => i.href)).toEqual(["/kyc"]);
  });
});

describe("authorization: role matrix", () => {
  const EXPECTED: Record<Role, string[]> = {
    viewer: ["kyc:read"],
    operator: ["kyc:read", "kyc:claim", "pii:reveal"],
    approver: ["kyc:read", "kyc:confirm", "pii:reveal"],
    admin: ["kyc:read", "kyc:claim", "kyc:confirm", "pii:reveal"],
  };
  const ALL = ["kyc:read", "kyc:claim", "kyc:confirm", "pii:reveal"];
  for (const role of ROLES) {
    for (const permission of ALL) {
      const allowed = EXPECTED[role].includes(permission);
      it(`${role} is ${allowed ? "allowed" : "denied"} ${permission}`, () => {
        const [type, action] = permission.split(":") as [string, string];
        expect(can(fakeUser(role), action, { type, attributes: { approvalRequesterId: "someone-else" } })).toBe(allowed);
      });
    }
  }

  it("kyc:decide is only allowed for operator/admin on a case assigned to them", () => {
    for (const role of ROLES) {
      const user = fakeUser(role);
      const own = can(user, "decide", { type: "kyc", id: "c1", attributes: { assignedAnalystId: user.id } });
      expect(own).toBe(role === "operator" || role === "admin");
      expect(can(user, "decide", { type: "kyc", id: "c1", attributes: { assignedAnalystId: "someone-else" } })).toBe(false);
      expect(can(user, "decide", { type: "kyc", id: "c1", attributes: { assignedAnalystId: null } })).toBe(false);
    }
  });

  it("kyc:confirm is denied to the user who requested the approval", () => {
    const user = fakeUser("approver");
    expect(can(user, "confirm", { type: "kyc", attributes: { approvalRequesterId: user.id } })).toBe(false);
  });
});

describe("status transitions", () => {
  it("allows only pending -> in_review -> approved | rejected | escalated", () => {
    const allowed = new Set(["pending>in_review", "in_review>approved", "in_review>rejected", "in_review>escalated"]);
    for (const from of KYC_STATUSES) {
      for (const to of KYC_STATUSES) {
        expect(canTransition(from, to), `${from} -> ${to}`).toBe(allowed.has(`${from}>${to}`));
      }
    }
    expect(canTransition("unknown", "in_review")).toBe(false);
  });

  it("new cases start pending and unassigned", async () => {
    const c = await newCase();
    expect(c).toMatchObject({ status: "pending", assignedAnalystId: null, decisionReason: null, country: "DE" });
  });

  it("claiming moves a pending case to in_review and assigns it", async () => {
    const c = await newCase();
    const claimed = await claimKycCase(operator, { caseId: c.id });
    expect(claimed).toMatchObject({ status: "in_review", assignedAnalystId: operator.id, assignedAnalystEmail: operator.email });
  });

  it("an in-review case cannot be claimed again", async () => {
    const c = await claimedCase(operator);
    await expect(claimKycCase(otherOperator, { caseId: c.id })).rejects.toBeInstanceOf(ConflictError);
    await expect(claimKycCase(operator, { caseId: c.id })).rejects.toBeInstanceOf(ConflictError);
  });

  it("a pending case cannot be decided before it is claimed", async () => {
    const c = await newCase();
    await expect(decideKycCase(operator, { caseId: c.id, decision: "reject", reason: "Document expired" })).rejects.toBeInstanceOf(ConflictError);
  });

  for (const [decision, status] of [["approve", "approved"], ["reject", "rejected"], ["escalate", "escalated"]] as const) {
    it(`${decision} moves an in-review case to ${status} with the reason, and it is final`, async () => {
      const c = await claimedCase(operator, 40);
      const { kycCase, approvalRequest } = await decideKycCase(operator, { caseId: c.id, decision, reason: "Checked documents" });
      expect(approvalRequest).toBeNull();
      expect(kycCase).toMatchObject({ status, decisionReason: "Checked documents" });
      await expect(decideKycCase(operator, { caseId: c.id, decision: "reject", reason: "Changed my mind" })).rejects.toBeInstanceOf(ConflictError);
      await expect(claimKycCase(operator, { caseId: c.id })).rejects.toBeInstanceOf(ConflictError);
    });
  }

  it("a decision needs a reason", async () => {
    const c = await claimedCase(operator);
    await expect(decideKycCase(operator, { caseId: c.id, decision: "reject", reason: "  " })).rejects.toBeInstanceOf(ZodError);
    expect((await prisma.kycCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("in_review");
  });
});

describe("only the assigned analyst can decide", () => {
  it("another operator is denied", async () => {
    const c = await claimedCase(operator);
    await expect(decideKycCase(otherOperator, { caseId: c.id, decision: "reject", reason: "Document expired" })).rejects.toThrow(NOT_ASSIGNED_MESSAGE);
  });

  it("an admin who is not assigned is denied", async () => {
    const c = await claimedCase(operator);
    await expect(decideKycCase(admin, { caseId: c.id, decision: "approve", reason: "Looks fine" })).rejects.toBeInstanceOf(AuthorizationError);
    expect((await prisma.kycCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("in_review");
  });
});

describe("role denials", () => {
  it("viewer and approver cannot claim", async () => {
    const c = await newCase();
    await expect(claimKycCase(viewer, { caseId: c.id })).rejects.toBeInstanceOf(AuthorizationError);
    await expect(claimKycCase(approver, { caseId: c.id })).rejects.toBeInstanceOf(AuthorizationError);
    expect((await prisma.kycCase.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("pending");
  });

  it("viewer and approver cannot decide", async () => {
    const c = await claimedCase(operator);
    for (const user of [viewer, approver]) {
      await expect(decideKycCase(user, { caseId: c.id, decision: "approve", reason: "Looks fine" })).rejects.toBeInstanceOf(AuthorizationError);
    }
  });

  it("viewer and operator cannot confirm a high-risk approval", async () => {
    const { kycCase } = await awaitingConfirmation(operator);
    for (const user of [viewer, otherOperator]) {
      await expect(confirmKycApproval(user, { caseId: kycCase.id, decision: "confirm" })).rejects.toBeInstanceOf(AuthorizationError);
    }
    expect((await prisma.kycCase.findUniqueOrThrow({ where: { id: kycCase.id } })).status).toBe("in_review");
  });

  it("viewer cannot reveal PII", async () => {
    const c = await newCase();
    await expect(revealPII(viewer, { entityType: "KycCase", entityId: c.id, field: "customerName" })).rejects.toBeInstanceOf(AuthorizationError);
    expect(await prisma.auditEvent.count({ where: { entityId: c.id, action: "pii.reveal" } })).toBe(0);
  });
});

describe("high-risk approval (riskScore >= 70) needs a second person", () => {
  it("risk score 69 is approved directly", async () => {
    const c = await claimedCase(operator, 69);
    const result = await decideKycCase(operator, { caseId: c.id, decision: "approve", reason: "Verified" });
    expect(result.approvalRequest).toBeNull();
    expect(result.kycCase.status).toBe("approved");
  });

  it("risk score 70 creates an approval request and the case stays in review, locked", async () => {
    const { kycCase, approvalRequest } = await awaitingConfirmation(operator);
    expect(kycCase).toMatchObject({ status: "in_review", approvalRequestId: approvalRequest.id, decisionReason: null });
    expect(approvalRequest).toMatchObject({ status: "pending", ruleKey: kycHighRiskApprovalRule.key, entityId: kycCase.id, requesterId: operator.id });
    expect(approvalRequest.payload).not.toContain(CUSTOMER_NAME);
    expect(approvalRequest.payload).not.toContain(DOCUMENT_NUMBER);
    await expect(decideKycCase(operator, { caseId: kycCase.id, decision: "reject", reason: "Changed my mind" })).rejects.toThrow(AWAITING_APPROVAL_MESSAGE);
  });

  it("a different approver confirms: the case is approved with the analyst's reason", async () => {
    const { kycCase } = await awaitingConfirmation(operator);
    const confirmed = await confirmKycApproval(approver, { caseId: kycCase.id, decision: "confirm", reason: "Second check done" });
    expect(confirmed).toMatchObject({ status: "approved", decisionReason: "Documents verified" });
  });

  it("a declined approval sends the case back to the analyst, who can then reject it", async () => {
    const { kycCase } = await awaitingConfirmation(operator);
    await expect(confirmKycApproval(approver, { caseId: kycCase.id, decision: "decline", reason: " " })).rejects.toBeInstanceOf(ZodError);
    const declined = await confirmKycApproval(approver, { caseId: kycCase.id, decision: "decline", reason: "Source of funds missing" });
    expect(declined).toMatchObject({ status: "in_review", approvalRequestId: null, assignedAnalystId: operator.id });
    const rejected = await decideKycCase(operator, { caseId: kycCase.id, decision: "reject", reason: "Source of funds missing" });
    expect(rejected.kycCase.status).toBe("rejected");
  });

  it("an approval decided on the generic approvals page is applied to the case", async () => {
    const { kycCase, approvalRequest } = await awaitingConfirmation(operator);
    await decideApproval(approver, { requestId: approvalRequest.id, decision: "approve" });
    expect(await syncDecidedKycCases([kycCase.id])).toBe(1);
    expect(await syncDecidedKycCases([kycCase.id])).toBe(0);
    expect((await prisma.kycCase.findUniqueOrThrow({ where: { id: kycCase.id } })).status).toBe("approved");
    const approveEvent = (await caseActions(kycCase.id)).find((e) => e.action === "kyc_case.approve");
    expect(approveEvent).toMatchObject({ actorId: null, actorEmail: "system" });
  });
});

describe("four-eyes: self-approval blocked for lead@demo.local", () => {
  it("lead (operator + approver) cannot confirm their own high-risk approval; the attempt is audited", async () => {
    const { kycCase, approvalRequest } = await awaitingConfirmation(lead);
    await expect(confirmKycApproval(lead, { caseId: kycCase.id, decision: "confirm" })).rejects.toThrow(SELF_APPROVAL_MESSAGE);
    await expect(decideApproval(lead, { requestId: approvalRequest.id, decision: "approve" })).rejects.toThrow(SELF_APPROVAL_MESSAGE);
    expect((await prisma.kycCase.findUniqueOrThrow({ where: { id: kycCase.id } })).status).toBe("in_review");
    expect((await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approvalRequest.id } })).status).toBe("pending");
    const blocked = (await caseActions(kycCase.id)).filter((e) => e.action === "kyc_case.self_approval_blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.actorId).toBe(lead.id);
  });

  it("admin cannot confirm an approval the admin requested", async () => {
    const { kycCase } = await awaitingConfirmation(admin);
    await expect(confirmKycApproval(admin, { caseId: kycCase.id, decision: "confirm" })).rejects.toThrow(SELF_APPROVAL_MESSAGE);
  });
});

describe("audit events", () => {
  it("every status change is audited with before/after status and masked PII", async () => {
    const { kycCase } = await awaitingConfirmation(operator);
    await confirmKycApproval(approver, { caseId: kycCase.id, decision: "confirm" });
    const events = await caseActions(kycCase.id);
    expect(events.map((e) => e.action)).toEqual(["kyc_case.create", "kyc_case.claim", "kyc_case.approval_requested", "kyc_case.approve"]);
    const statusOf = (s: string | null) => (s ? (JSON.parse(s) as { status: string }).status : null);
    expect(events.map((e) => [statusOf(e.before), statusOf(e.after)])).toEqual([
      [null, "pending"],
      ["pending", "in_review"],
      ["in_review", "in_review"],
      ["in_review", "approved"],
    ]);
    expect(events.at(-1)!.actorId).toBe(approver.id);
    for (const e of events) {
      expect(`${e.before}${e.after}`).not.toContain(CUSTOMER_NAME);
      expect(`${e.before}${e.after}`).not.toContain(DOCUMENT_NUMBER);
      expect(`${e.before}${e.after}`).not.toContain("1985-04-12");
    }
  });

  for (const decision of ["reject", "escalate"] as const) {
    it(`${decision} is audited`, async () => {
      const c = await claimedCase(operator);
      await decideKycCase(operator, { caseId: c.id, decision, reason: "Checked" });
      expect((await caseActions(c.id)).map((e) => e.action)).toEqual(["kyc_case.create", "kyc_case.claim", `kyc_case.${decision}`]);
    });
  }

  it("a declined approval is audited", async () => {
    const { kycCase } = await awaitingConfirmation(operator);
    await confirmKycApproval(approver, { caseId: kycCase.id, decision: "decline", reason: "Missing proof" });
    expect((await caseActions(kycCase.id)).map((e) => e.action)).toContain("kyc_case.approval_declined");
  });

  it("denied actions do not change the case or write status events", async () => {
    const c = await claimedCase(operator);
    await expect(decideKycCase(otherOperator, { caseId: c.id, decision: "reject", reason: "Nope" })).rejects.toBeInstanceOf(AuthorizationError);
    expect((await caseActions(c.id)).map((e) => e.action)).toEqual(["kyc_case.create", "kyc_case.claim"]);
  });
});

describe("PII", () => {
  for (const [field, value] of [["customerName", CUSTOMER_NAME], ["dateOfBirth", "1985-04-12"], ["documentNumber", DOCUMENT_NUMBER]] as const) {
    it(`revealing ${field} returns the value and writes one audit event (field only, no value)`, async () => {
      const c = await newCase();
      for (const user of [operator, approver, admin]) {
        expect(await revealPII(user, { entityType: "KycCase", entityId: c.id, field })).toBe(value);
      }
      const reveals = await prisma.auditEvent.findMany({ where: { entityType: "KycCase", entityId: c.id, action: "pii.reveal" } });
      expect(reveals.map((e) => e.actorId).sort()).toEqual([operator.id, approver.id, admin.id].sort());
      for (const e of reveals) {
        expect(JSON.parse(e.metadata!)).toEqual({ field });
        expect(e.metadata).not.toContain(value);
      }
    });
  }

  it("non-PII fields cannot be revealed through the resolver", async () => {
    const c = await newCase();
    await expect(revealPII(operator, { entityType: "KycCase", entityId: c.id, field: "country" })).rejects.toThrow();
  });
});

describe("queue filters", () => {
  it("builds where clauses for status, risk range and analyst", () => {
    expect(buildKycWhere({})).toEqual({});
    expect(buildKycWhere({ status: "pending", minRisk: "70", maxRisk: "90", analyst: "u1" })).toEqual({
      status: "pending",
      riskScore: { gte: 70, lte: 90 },
      assignedAnalystId: "u1",
    });
    expect(buildKycWhere({ analyst: UNASSIGNED })).toEqual({ assignedAnalystId: null });
    expect(buildKycWhere({ minRisk: "abc", maxRisk: "500" })).toEqual({});
  });
});
