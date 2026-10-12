import { prisma, type DbTransaction } from "@/platform/db";
import { maskObject } from "@/platform/pii/mask";
import type { PiiFieldMap } from "@/platform/pii/types";
import type { AuditActor, AuditEventInput } from "./types";

function toJson(value: unknown, piiFields?: PiiFieldMap): string | null {
  if (value === undefined || value === null) return null;
  const masked = piiFields && typeof value === "object" ? maskObject(value as Record<string, unknown>, piiFields) : value;
  return JSON.stringify(masked);
}

/** Appends one audit event. Only INSERT is ever issued against audit_events. */
export async function recordAuditEvent(
  event: AuditEventInput,
  tx: DbTransaction = prisma,
  piiFields?: PiiFieldMap,
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      actorId: event.actor.id,
      actorEmail: event.actor.email,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      before: toJson(event.before, piiFields),
      after: toJson(event.after, piiFields),
      metadata: event.metadata ? JSON.stringify(event.metadata) : null,
      createdAt: new Date(),
    },
  });
}

export interface AuditContext {
  actor: AuditActor;
  /** Verb in `<entity>.<verb>` form, e.g. `approval.approve`. */
  action: string;
  entityType: string;
  /** Fields in before/after snapshots that hold PII; they are stored masked. */
  piiFields?: PiiFieldMap;
  metadata?: Record<string, unknown>;
}

export interface AuditedMutationResult<T> {
  entityId: string;
  before?: unknown;
  after?: unknown;
  result: T;
}

/**
 * Runs a data change and its audit event in one transaction: either both are
 * committed or neither is. Every create, update and delete must go through this.
 */
export async function withAudit<T>(
  context: AuditContext,
  mutation: (tx: DbTransaction) => Promise<AuditedMutationResult<T>>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    const outcome = await mutation(tx);
    await recordAuditEvent(
      {
        actor: context.actor,
        action: context.action,
        entityType: context.entityType,
        entityId: outcome.entityId,
        before: outcome.before,
        after: outcome.after,
        metadata: context.metadata,
      },
      tx,
      context.piiFields,
    );
    return outcome.result;
  });
}
