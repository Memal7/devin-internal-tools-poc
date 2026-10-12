import type { ApprovalRequest, Payment, Refund } from "@prisma/client";
import { z } from "zod";
import { decideApproval, requestApproval, SELF_APPROVAL_MESSAGE } from "@/platform/approvals/service";
import { actorFromUser, SYSTEM_ACTOR, type AuditActor } from "@/platform/audit/types";
import { recordAuditEvent, withAudit } from "@/platform/audit/with-audit";
import { prisma, type DbTransaction } from "@/platform/db";
import { AuthorizationError, ConflictError, NotFoundError } from "@/platform/errors";
import { formatMinor } from "@/platform/money";
import { assertCan } from "@/platform/rbac/assert";
import { hasPermission } from "@/platform/rbac/policy";
import type { AuthUser } from "@/platform/rbac/types";
import { refundableMinor } from "./payments";
import { REFUND_PERMISSIONS, refundResource } from "./permissions";
import { PAYMENT_ENTITY, REFUND_ENTITY, refundApprovalRule } from "./rules";

export const OVER_REFUND_MESSAGE = "Total refunds would exceed the payment amount.";

export const requestRefundSchema = z.object({
  paymentId: z.string().trim().min(1, "Required").max(100),
  amountMinor: z.number().int().positive("Amount must be greater than zero").max(Number.MAX_SAFE_INTEGER),
  reason: z.string().trim().min(3, "At least 3 characters").max(500),
});

export type RequestRefundInput = z.input<typeof requestRefundSchema>;

export const decideRefundSchema = z.discriminatedUnion("decision", [
  z.object({ refundId: z.string().min(1).max(100), decision: z.literal("approve"), reason: z.string().trim().max(500).optional() }),
  z.object({
    refundId: z.string().min(1).max(100),
    decision: z.literal("decline"),
    reason: z.string().trim().min(1, "A reason is required to decline").max(500),
  }),
]);

export type DecideRefundInput = z.input<typeof decideRefundSchema>;

export interface RequestRefundResult {
  refund: Refund;
  approvalRequest: ApprovalRequest | null;
}

class AlreadyApplied extends Error {}

/** Reserves `refund.amountMinor` on the payment. Atomic: fails if it would exceed the payment amount. */
async function reserveOnPayment(tx: DbTransaction, actor: AuditActor, payment: Payment, refund: Refund) {
  const { count } = await tx.payment.updateMany({
    where: { id: payment.id, refundedMinor: { lte: payment.amountMinor - refund.amountMinor } },
    data: { refundedMinor: { increment: refund.amountMinor } },
  });
  if (count !== 1) throw new ConflictError(OVER_REFUND_MESSAGE);
  const updated = await tx.payment.findUniqueOrThrow({ where: { id: payment.id }, select: { refundedMinor: true } });
  await recordAuditEvent(
    {
      actor,
      action: "payment.refund_reserved",
      entityType: PAYMENT_ENTITY,
      entityId: payment.id,
      before: { refundedMinor: updated.refundedMinor - refund.amountMinor },
      after: { refundedMinor: updated.refundedMinor },
      metadata: { refundId: refund.id, amountMinor: refund.amountMinor, currency: refund.currency },
    },
    tx,
  );
}

/** Releases a declined refund's reservation so the amount can be refunded again. */
async function releaseOnPayment(tx: DbTransaction, actor: AuditActor, refund: Refund) {
  const { count } = await tx.payment.updateMany({
    where: { id: refund.paymentId, refundedMinor: { gte: refund.amountMinor } },
    data: { refundedMinor: { decrement: refund.amountMinor } },
  });
  if (count !== 1) throw new Error("Refund ledger is inconsistent.");
  const updated = await tx.payment.findUniqueOrThrow({ where: { id: refund.paymentId }, select: { refundedMinor: true } });
  await recordAuditEvent(
    {
      actor,
      action: "payment.refund_released",
      entityType: PAYMENT_ENTITY,
      entityId: refund.paymentId,
      before: { refundedMinor: updated.refundedMinor + refund.amountMinor },
      after: { refundedMinor: updated.refundedMinor },
      metadata: { refundId: refund.id, amountMinor: refund.amountMinor, currency: refund.currency },
    },
    tx,
  );
}

export function findRefundApprovalRequest(refundId: string): Promise<ApprovalRequest | null> {
  return prisma.approvalRequest.findFirst({
    where: { ruleKey: refundApprovalRule.key, entityType: REFUND_ENTITY, entityId: refundId },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Requests a refund. Up to 500.00 EUR it is auto-approved; above that the refund stays
 * `requested` and a platform approval request is created for a second person.
 * The amount is reserved on the payment in the same transaction, so total refunds
 * (requested + approved) can never exceed the payment amount.
 */
export async function requestRefund(user: AuthUser, rawInput: RequestRefundInput): Promise<RequestRefundResult> {
  assertCan(user, "create", refundResource());
  const input = requestRefundSchema.parse(rawInput);
  const payment = await prisma.payment.findUnique({ where: { id: input.paymentId } });
  if (!payment) throw new NotFoundError("Payment not found.");
  assertCan(user, "read", { type: "payment", id: payment.id });
  if (payment.status !== "succeeded") throw new ConflictError("Only succeeded payments can be refunded.");
  if (input.amountMinor > refundableMinor(payment)) throw new ConflictError(OVER_REFUND_MESSAGE);

  const needsApproval = refundApprovalRule.requiresApproval({ amountMinor: input.amountMinor, currency: payment.currency });
  const actor = actorFromUser(user);
  const now = new Date();
  const refund = await withAudit(
    { actor, action: "refund.request", entityType: REFUND_ENTITY, metadata: { autoApproved: !needsApproval, ruleKey: refundApprovalRule.key } },
    async (tx) => {
      const created = await tx.refund.create({
        data: {
          paymentId: payment.id,
          amountMinor: input.amountMinor,
          currency: payment.currency,
          reason: input.reason,
          status: needsApproval ? "requested" : "auto_approved",
          requestedById: user.id,
          requestedByEmail: user.email,
          ...(needsApproval ? {} : { decidedById: null, decidedByEmail: SYSTEM_ACTOR.email, decisionReason: "Auto-approved: within limit", decidedAt: now }),
        },
      });
      await reserveOnPayment(tx, actor, payment, created);
      return { entityId: created.id, after: created, result: created };
    },
  );
  if (!needsApproval) return { refund, approvalRequest: null };

  try {
    const approval = await requestApproval(user, {
      ruleKey: refundApprovalRule.key,
      entityType: REFUND_ENTITY,
      entityId: refund.id,
      summary: `Refund ${formatMinor(refund.amountMinor, refund.currency)} for ${payment.reference}`,
      amountMinor: refund.amountMinor,
      currency: refund.currency,
      payload: { paymentReference: payment.reference, reason: refund.reason },
    });
    if (!approval.required) throw new Error("Approval rule mismatch.");
    return { refund, approvalRequest: approval.request };
  } catch (error) {
    // Never leave a refund waiting for an approval request that does not exist.
    await withAudit({ actor, action: "refund.cancel", entityType: REFUND_ENTITY, metadata: { cause: "approval_request_failed" } }, async (tx) => {
      const { count } = await tx.refund.updateMany({
        where: { id: refund.id, status: "requested" },
        data: { status: "declined", decidedByEmail: SYSTEM_ACTOR.email, decisionReason: "Approval request could not be created", decidedAt: new Date() },
      });
      if (count === 1) await releaseOnPayment(tx, actor, refund);
      const after = await tx.refund.findUniqueOrThrow({ where: { id: refund.id } });
      return { entityId: refund.id, before: refund, after, result: after };
    });
    throw error;
  }
}

/**
 * Copies a decided approval request onto its refund (approved or declined; declines release
 * the reserved amount). Idempotent: returns null if the refund was already updated.
 */
async function applyApprovalOutcome(
  actor: AuditActor,
  refundId: string,
  approval: ApprovalRequest,
  metadata: Record<string, unknown> = {},
): Promise<Refund | null> {
  if (approval.status !== "approved" && approval.status !== "declined") return null;
  const target = approval.status;
  try {
    return await withAudit(
      {
        actor,
        action: target === "approved" ? "refund.approve" : "refund.decline",
        entityType: REFUND_ENTITY,
        metadata: { approvalRequestId: approval.id, ...metadata },
      },
      async (tx) => {
        const before = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
        const { count } = await tx.refund.updateMany({
          where: { id: refundId, status: "requested" },
          data: {
            status: target,
            decidedById: approval.deciderId,
            decidedByEmail: approval.deciderEmail,
            decisionReason: approval.decisionReason,
            decidedAt: approval.decidedAt ?? new Date(),
          },
        });
        if (count !== 1) throw new AlreadyApplied();
        if (target === "declined") await releaseOnPayment(tx, actor, before);
        const after = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
        return { entityId: refundId, before, after, result: after };
      },
    );
  } catch (error) {
    if (error instanceof AlreadyApplied) return null;
    throw error;
  }
}

/**
 * Brings `requested` refunds in line with approval requests that were decided elsewhere
 * (e.g. on the generic /approvals page). Audited as a system action.
 */
export async function syncDecidedRefunds(refundIds?: readonly string[]): Promise<number> {
  const waiting = await prisma.refund.findMany({
    where: { status: "requested", ...(refundIds ? { id: { in: [...refundIds] } } : {}) },
    select: { id: true },
  });
  if (waiting.length === 0) return 0;
  const decided = await prisma.approvalRequest.findMany({
    where: {
      ruleKey: refundApprovalRule.key,
      entityType: REFUND_ENTITY,
      entityId: { in: waiting.map((r) => r.id) },
      status: { in: ["approved", "declined"] },
    },
  });
  let applied = 0;
  for (const approval of decided) {
    if (await applyApprovalOutcome(SYSTEM_ACTOR, approval.entityId, approval, { source: "approval_sync" })) applied += 1;
  }
  return applied;
}

/**
 * Approves or declines a refund above the auto-approve limit. Enforced on the server:
 * - the user needs `refund:decide` (and `approval:decide`, checked by the platform)
 * - the user must not be the requester (four-eyes); blocked attempts are audited
 * - the decision goes through the platform approvals module, then is applied to the refund
 */
export async function decideRefund(user: AuthUser, rawInput: DecideRefundInput): Promise<Refund> {
  if (!hasPermission(user, REFUND_PERMISSIONS.refundDecide)) throw new AuthorizationError();
  const input = decideRefundSchema.parse(rawInput);
  const refund = await prisma.refund.findUnique({ where: { id: input.refundId } });
  if (!refund) throw new NotFoundError("Refund not found.");

  if (refund.requestedById === user.id) {
    await recordAuditEvent({
      actor: actorFromUser(user),
      action: "refund.self_approval_blocked",
      entityType: REFUND_ENTITY,
      entityId: refund.id,
      metadata: { attemptedDecision: input.decision },
    });
    throw new AuthorizationError(SELF_APPROVAL_MESSAGE);
  }
  assertCan(user, "decide", refundResource(refund));
  if (refund.status !== "requested") throw new ConflictError(`This refund is already ${refund.status.replace("_", "-")}.`);

  const approval = await findRefundApprovalRequest(refund.id);
  if (!approval) throw new ConflictError("This refund has no approval request.");
  if (approval.status !== "pending") {
    await applyApprovalOutcome(SYSTEM_ACTOR, refund.id, approval, { source: "approval_sync" });
    throw new ConflictError("This refund was already decided.");
  }

  const decided = await decideApproval(
    user,
    input.decision === "approve"
      ? { requestId: approval.id, decision: "approve", reason: input.reason }
      : { requestId: approval.id, decision: "decline", reason: input.reason },
  );
  const updated = await applyApprovalOutcome(actorFromUser(user), refund.id, decided);
  return updated ?? prisma.refund.findUniqueOrThrow({ where: { id: refund.id } });
}
