import type { ApprovalRequest, KycCase } from "@prisma/client";
import { z } from "zod";
import { decideApproval, requestApproval, SELF_APPROVAL_MESSAGE } from "@/platform/approvals/service";
import { actorFromUser, SYSTEM_ACTOR, type AuditActor } from "@/platform/audit/types";
import { recordAuditEvent, withAudit } from "@/platform/audit/with-audit";
import { prisma } from "@/platform/db";
import { AuthorizationError, ConflictError, NotFoundError } from "@/platform/errors";
import { assertCan } from "@/platform/rbac/assert";
import { hasPermission } from "@/platform/rbac/policy";
import type { AuthUser } from "@/platform/rbac/types";
import { KYC_PERMISSIONS, kycCaseResource } from "./permissions";
import { KYC_PII_FIELDS } from "./pii";
import { isHighRisk, KYC_CASE_ENTITY, kycHighRiskApprovalRule } from "./rules";
import { canTransition, DECISION_TARGET, DOCUMENT_TYPES, KYC_DECISIONS, statusLabel } from "./status";

export const NOT_ASSIGNED_MESSAGE = "Only the analyst assigned to this case can decide it.";
export const AWAITING_APPROVAL_MESSAGE = "This case is waiting for a second approver to confirm the approval.";
export const STALE_CASE_MESSAGE = "This case changed in the meantime. Reload the page and try again.";

const caseId = z.string().trim().min(1).max(100);

function isPastIsoDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value && date.getTime() < Date.now();
}

export const createKycCaseSchema = z.object({
  reference: z.string().trim().regex(/^KYC-\d{6}$/, "Use the format KYC-000123"),
  customerName: z.string().trim().min(2).max(200),
  dateOfBirth: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine(isPastIsoDate, "Enter a valid date in the past"),
  documentType: z.enum(DOCUMENT_TYPES),
  documentNumber: z
    .string()
    .trim()
    .transform((value) => value.replace(/\s+/g, "").toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{5,20}$/, "Use 5 to 20 letters or digits")),
  country: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.string().regex(/^[A-Z]{2}$/, "Use a 2-letter ISO country code")),
  riskScore: z.number().int().min(0).max(100),
  createdAt: z.date().optional(),
});

export const claimKycCaseSchema = z.object({ caseId });

export const decideKycCaseSchema = z.object({
  caseId,
  decision: z.enum(KYC_DECISIONS, { error: "Choose approve, reject or escalate" }),
  reason: z.string().trim().min(3, "A reason of at least 3 characters is required").max(500),
});

export const confirmKycApprovalSchema = z.discriminatedUnion(
  "decision",
  [
    z.object({ caseId, decision: z.literal("confirm"), reason: z.string().trim().max(500).optional() }),
    z.object({ caseId, decision: z.literal("decline"), reason: z.string().trim().min(1, "A reason is required to decline").max(500) }),
  ],
  { error: "Choose confirm or decline" },
);

export interface DecideKycCaseResult {
  kycCase: KycCase;
  /** Set when a high-risk approval now waits for a second person. */
  approvalRequest: ApprovalRequest | null;
}

class AlreadyApplied extends Error {}

const audit = (actor: AuditActor, action: string, metadata?: Record<string, unknown>) => ({
  actor,
  action,
  entityType: KYC_CASE_ENTITY,
  piiFields: KYC_PII_FIELDS,
  metadata,
});

/** Creates a case (audited, PII masked in the snapshot). Cases come from onboarding; used by seed and tests. */
export async function createKycCase(actor: AuditActor, rawInput: z.input<typeof createKycCaseSchema>): Promise<KycCase> {
  const input = createKycCaseSchema.parse(rawInput);
  return withAudit(audit(actor, "kyc_case.create"), async (tx) => {
    const created = await tx.kycCase.create({ data: { ...input, status: "pending" } });
    return { entityId: created.id, after: created, result: created };
  });
}

/** pending -> in_review, assigned to the user. Atomic: only one analyst can claim a case. */
export async function claimKycCase(user: AuthUser, rawInput: z.input<typeof claimKycCaseSchema>): Promise<KycCase> {
  assertCan(user, "claim", kycCaseResource());
  const input = claimKycCaseSchema.parse(rawInput);
  const existing = await prisma.kycCase.findUnique({ where: { id: input.caseId } });
  if (!existing) throw new NotFoundError("Case not found.");
  assertCan(user, "claim", kycCaseResource(existing));
  if (!canTransition(existing.status, "in_review")) {
    throw new ConflictError(`Only pending cases can be claimed. This case is ${statusLabel(existing.status).toLowerCase()}.`);
  }
  return withAudit(audit(actorFromUser(user), "kyc_case.claim"), async (tx) => {
    const before = await tx.kycCase.findUniqueOrThrow({ where: { id: existing.id } });
    const { count } = await tx.kycCase.updateMany({
      where: { id: existing.id, status: "pending", assignedAnalystId: null },
      data: { status: "in_review", assignedAnalystId: user.id, assignedAnalystEmail: user.email },
    });
    if (count !== 1) throw new ConflictError("This case was already claimed.");
    const after = await tx.kycCase.findUniqueOrThrow({ where: { id: existing.id } });
    return { entityId: existing.id, before, after, result: after };
  });
}

/**
 * The assigned analyst approves, rejects or escalates an in-review case, always with a reason.
 * Approving a high-risk case (riskScore >= 70) does not finish it: it creates a platform
 * approval request that a different user with the approver role must confirm.
 */
export async function decideKycCase(user: AuthUser, rawInput: z.input<typeof decideKycCaseSchema>): Promise<DecideKycCaseResult> {
  if (!hasPermission(user, KYC_PERMISSIONS.decide)) throw new AuthorizationError();
  const input = decideKycCaseSchema.parse(rawInput);
  const existing = await prisma.kycCase.findUnique({ where: { id: input.caseId } });
  if (!existing) throw new NotFoundError("Case not found.");

  const target = DECISION_TARGET[input.decision];
  if (!canTransition(existing.status, target)) {
    throw new ConflictError(`A ${statusLabel(existing.status).toLowerCase()} case cannot be ${target}. Only in-review cases can be decided.`);
  }
  if (existing.assignedAnalystId !== user.id) throw new AuthorizationError(NOT_ASSIGNED_MESSAGE);
  assertCan(user, "decide", kycCaseResource(existing), NOT_ASSIGNED_MESSAGE);
  if (existing.approvalRequestId) throw new ConflictError(AWAITING_APPROVAL_MESSAGE);

  if (input.decision === "approve" && isHighRisk(existing.riskScore)) {
    return requestHighRiskApproval(user, existing, input.reason);
  }

  const kycCase = await withAudit(audit(actorFromUser(user), `kyc_case.${input.decision}`), async (tx) => {
    const before = await tx.kycCase.findUniqueOrThrow({ where: { id: existing.id } });
    const { count } = await tx.kycCase.updateMany({
      where: { id: existing.id, status: "in_review", assignedAnalystId: user.id, approvalRequestId: null },
      data: { status: target, decisionReason: input.reason },
    });
    if (count !== 1) throw new ConflictError(STALE_CASE_MESSAGE);
    const after = await tx.kycCase.findUniqueOrThrow({ where: { id: existing.id } });
    return { entityId: existing.id, before, after, result: after };
  });
  return { kycCase, approvalRequest: null };
}

async function requestHighRiskApproval(user: AuthUser, existing: KycCase, reason: string): Promise<DecideKycCaseResult> {
  const approval = await requestApproval(user, {
    ruleKey: kycHighRiskApprovalRule.key,
    entityType: KYC_CASE_ENTITY,
    entityId: existing.id,
    summary: `Approve KYC case ${existing.reference} (risk score ${existing.riskScore})`,
    // No PII in the payload: it is shown on the generic approvals pages.
    payload: { caseReference: existing.reference, riskScore: existing.riskScore, country: existing.country, analystReason: reason },
  });
  if (!approval.required) throw new Error("Approval rule mismatch.");
  const request = approval.request;
  const kycCase = await withAudit(
    audit(actorFromUser(user), "kyc_case.approval_requested", { approvalRequestId: request.id, riskScore: existing.riskScore }),
    async (tx) => {
      const before = await tx.kycCase.findUniqueOrThrow({ where: { id: existing.id } });
      const { count } = await tx.kycCase.updateMany({
        where: { id: existing.id, status: "in_review", assignedAnalystId: user.id, approvalRequestId: null },
        data: { approvalRequestId: request.id },
      });
      if (count !== 1) throw new ConflictError(STALE_CASE_MESSAGE);
      const after = await tx.kycCase.findUniqueOrThrow({ where: { id: existing.id } });
      return { entityId: existing.id, before, after, result: after };
    },
  );
  return { kycCase, approvalRequest: request };
}

function analystReason(approval: ApprovalRequest): string {
  const value = (JSON.parse(approval.payload) as Record<string, unknown>).analystReason;
  return typeof value === "string" && value.length > 0 ? value : "Approved after second-person confirmation";
}

/**
 * Copies a decided approval request onto its case: approved -> case approved (with the
 * analyst's reason); declined -> case stays in review, unlocked so the analyst can reject or
 * escalate. Idempotent: returns null if the outcome was already applied.
 */
async function applyApprovalOutcome(
  actor: AuditActor,
  kycCaseId: string,
  approval: ApprovalRequest,
  metadata: Record<string, unknown> = {},
): Promise<KycCase | null> {
  if (approval.status !== "approved" && approval.status !== "declined") return null;
  const approved = approval.status === "approved";
  try {
    return await withAudit(
      audit(actor, approved ? "kyc_case.approve" : "kyc_case.approval_declined", {
        approvalRequestId: approval.id,
        decidedById: approval.deciderId,
        ...metadata,
      }),
      async (tx) => {
        const before = await tx.kycCase.findUniqueOrThrow({ where: { id: kycCaseId } });
        const { count } = await tx.kycCase.updateMany({
          where: { id: kycCaseId, status: "in_review", approvalRequestId: approval.id },
          data: approved ? { status: "approved", decisionReason: analystReason(approval) } : { approvalRequestId: null },
        });
        if (count !== 1) throw new AlreadyApplied();
        const after = await tx.kycCase.findUniqueOrThrow({ where: { id: kycCaseId } });
        return { entityId: kycCaseId, before, after, result: after };
      },
    );
  } catch (error) {
    if (error instanceof AlreadyApplied) return null;
    throw error;
  }
}

/**
 * An approver confirms or declines a high-risk approval. Enforced on the server:
 * - the user needs `kyc:confirm` (and `approval:decide`, checked by the platform)
 * - the user must not be the analyst who requested it (four-eyes); blocked attempts are audited
 * - the decision goes through the platform approvals module, then is applied to the case
 */
export async function confirmKycApproval(user: AuthUser, rawInput: z.input<typeof confirmKycApprovalSchema>): Promise<KycCase> {
  if (!hasPermission(user, KYC_PERMISSIONS.confirm)) throw new AuthorizationError();
  const input = confirmKycApprovalSchema.parse(rawInput);
  const existing = await prisma.kycCase.findUnique({ where: { id: input.caseId } });
  if (!existing) throw new NotFoundError("Case not found.");
  if (existing.status !== "in_review" || !existing.approvalRequestId) {
    throw new ConflictError("This case has no approval waiting for confirmation.");
  }
  const approval = await prisma.approvalRequest.findUnique({ where: { id: existing.approvalRequestId } });
  if (!approval) throw new ConflictError("This case has no approval waiting for confirmation.");

  if (approval.requesterId === user.id) {
    await recordAuditEvent({
      actor: actorFromUser(user),
      action: "kyc_case.self_approval_blocked",
      entityType: KYC_CASE_ENTITY,
      entityId: existing.id,
      metadata: { approvalRequestId: approval.id, attemptedDecision: input.decision },
    });
    throw new AuthorizationError(SELF_APPROVAL_MESSAGE);
  }
  assertCan(user, "confirm", kycCaseResource(existing, approval.requesterId), SELF_APPROVAL_MESSAGE);

  if (approval.status !== "pending") {
    await applyApprovalOutcome(SYSTEM_ACTOR, existing.id, approval, { source: "approval_sync" });
    throw new ConflictError("This approval was already decided.");
  }

  const decided = await decideApproval(
    user,
    input.decision === "confirm"
      ? { requestId: approval.id, decision: "approve", reason: input.reason }
      : { requestId: approval.id, decision: "decline", reason: input.reason },
  );
  const updated = await applyApprovalOutcome(actorFromUser(user), existing.id, decided);
  return updated ?? prisma.kycCase.findUniqueOrThrow({ where: { id: existing.id } });
}

/**
 * Applies approval requests that were decided elsewhere (e.g. on the generic /approvals page)
 * to their cases. Audited as a system action.
 */
export async function syncDecidedKycCases(caseIds?: readonly string[]): Promise<number> {
  const waiting = await prisma.kycCase.findMany({
    where: { status: "in_review", approvalRequestId: { not: null }, ...(caseIds ? { id: { in: [...caseIds] } } : {}) },
    select: { id: true, approvalRequestId: true },
  });
  if (waiting.length === 0) return 0;
  const caseByApproval = new Map(waiting.map((c) => [c.approvalRequestId!, c.id]));
  const decided = await prisma.approvalRequest.findMany({
    where: { id: { in: [...caseByApproval.keys()] }, status: { in: ["approved", "declined"] } },
  });
  let applied = 0;
  for (const approval of decided) {
    const kycCaseId = caseByApproval.get(approval.id)!;
    if (await applyApprovalOutcome(SYSTEM_ACTOR, kycCaseId, approval, { source: "approval_sync" })) applied += 1;
  }
  return applied;
}
