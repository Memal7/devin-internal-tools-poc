import { z } from "zod";
import type { ApprovalRequest } from "@prisma/client";
import { recordAuditEvent, withAudit } from "@/platform/audit/with-audit";
import { actorFromUser } from "@/platform/audit/types";
import { prisma } from "@/platform/db";
import { AuthorizationError, ConflictError, NotFoundError } from "@/platform/errors";
import { assertCan } from "@/platform/rbac/assert";
import { PLATFORM_PERMISSIONS } from "@/platform/rbac/permissions";
import { hasPermission } from "@/platform/rbac/policy";
import type { AuthUser, Resource } from "@/platform/rbac/types";
import { getApprovalRule } from "./registry";
import { canTransition, type ApprovalStatus } from "./status";

export const APPROVAL_ENTITY = "ApprovalRequest";

export const SELF_APPROVAL_MESSAGE = "You cannot approve or decline your own request (four-eyes rule).";

export function approvalResource(request?: Pick<ApprovalRequest, "id" | "requesterId">): Resource {
  return request
    ? { type: "approval", id: request.id, attributes: { requesterId: request.requesterId } }
    : { type: "approval" };
}

export const requestApprovalSchema = z.object({
  ruleKey: z.string().min(1).max(100),
  entityType: z.string().min(1).max(100),
  entityId: z.string().min(1).max(100),
  summary: z.string().trim().min(1).max(200),
  amountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code")
    .optional(),
  payload: z.record(z.string(), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).default({}),
});

export type RequestApprovalInput = z.input<typeof requestApprovalSchema>;

export type RequestApprovalResult =
  | { required: false }
  | { required: true; request: ApprovalRequest };

function snapshot(request: ApprovalRequest) {
  return { ...request, payload: JSON.parse(request.payload) as Record<string, unknown> };
}

function auditPiiFields(ruleKey: string) {
  const fields = getApprovalRule(ruleKey)?.payloadPiiFields ?? {};
  return Object.fromEntries(Object.entries(fields).map(([field, kind]) => [`payload.${field}`, kind]));
}

/**
 * Evaluates the rule and, if approval is needed, creates a pending request.
 * Apps call this instead of finishing a high-risk action directly.
 */
export async function requestApproval(user: AuthUser, rawInput: RequestApprovalInput): Promise<RequestApprovalResult> {
  assertCan(user, "create", approvalResource());
  const input = requestApprovalSchema.parse(rawInput);
  const rule = getApprovalRule(input.ruleKey);
  if (!rule || rule.entityType !== input.entityType) throw new NotFoundError("Unknown approval rule.");
  if (!rule.requiresApproval({ amountMinor: input.amountMinor, currency: input.currency })) {
    return { required: false };
  }
  const request = await withAudit(
    { actor: actorFromUser(user), action: "approval.request", entityType: APPROVAL_ENTITY, piiFields: auditPiiFields(rule.key) },
    async (tx) => {
      const created = await tx.approvalRequest.create({
        data: {
          ruleKey: rule.key,
          entityType: input.entityType,
          entityId: input.entityId,
          summary: input.summary,
          amountMinor: input.amountMinor ?? null,
          currency: input.currency ?? null,
          payload: JSON.stringify(input.payload),
          status: "pending",
          requesterId: user.id,
          requesterEmail: user.email,
        },
      });
      return { entityId: created.id, after: snapshot(created), result: created };
    },
  );
  return { required: true, request };
}

export const decisionSchema = z.discriminatedUnion("decision", [
  z.object({ requestId: z.string().min(1), decision: z.literal("approve"), reason: z.string().trim().max(500).optional() }),
  z.object({ requestId: z.string().min(1), decision: z.literal("decline"), reason: z.string().trim().min(1, "A reason is required to decline").max(500) }),
]);

export type DecisionInput = z.input<typeof decisionSchema>;

/**
 * Approves or declines a pending request. Enforced on the server:
 * - the user needs `approval:decide`
 * - the user must not be the requester (four-eyes); blocked attempts are audited
 * - only pending requests can change state (checked atomically)
 */
export async function decideApproval(user: AuthUser, rawInput: DecisionInput): Promise<ApprovalRequest> {
  // Role-level check first; the resource-level check (four-eyes) needs the stored record.
  if (!hasPermission(user, PLATFORM_PERMISSIONS.approvalDecide)) throw new AuthorizationError();
  const input = decisionSchema.parse(rawInput);
  const existing = await prisma.approvalRequest.findUnique({ where: { id: input.requestId } });
  if (!existing) throw new NotFoundError("Approval request not found.");

  if (existing.requesterId === user.id) {
    await recordAuditEvent({
      actor: actorFromUser(user),
      action: "approval.self_approval_blocked",
      entityType: APPROVAL_ENTITY,
      entityId: existing.id,
      metadata: { attemptedDecision: input.decision },
    });
    throw new AuthorizationError(SELF_APPROVAL_MESSAGE);
  }
  assertCan(user, "decide", approvalResource(existing));

  const target: ApprovalStatus = input.decision === "approve" ? "approved" : "declined";
  if (!canTransition(existing.status, target)) {
    throw new ConflictError(`This request is already ${existing.status}.`);
  }

  return withAudit(
    {
      actor: actorFromUser(user),
      action: `approval.${input.decision}`,
      entityType: APPROVAL_ENTITY,
      piiFields: auditPiiFields(existing.ruleKey),
    },
    async (tx) => {
      const { count } = await tx.approvalRequest.updateMany({
        where: { id: existing.id, status: "pending", requesterId: { not: user.id } },
        data: {
          status: target,
          deciderId: user.id,
          deciderEmail: user.email,
          decisionReason: input.reason || null,
          decidedAt: new Date(),
        },
      });
      if (count !== 1) throw new ConflictError("This request was already decided.");
      const updated = await tx.approvalRequest.findUniqueOrThrow({ where: { id: existing.id } });
      return { entityId: updated.id, before: snapshot(existing), after: snapshot(updated), result: updated };
    },
  );
}

export async function getApprovalRequest(user: AuthUser, id: string): Promise<ApprovalRequest> {
  assertCan(user, "read", { type: "approval", id });
  const request = await prisma.approvalRequest.findUnique({ where: { id } });
  if (!request) throw new NotFoundError("Approval request not found.");
  return request;
}
