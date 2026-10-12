import type { AuthUser } from "@/platform/rbac/types";

export interface AuditActor {
  /** null for system actions such as seeding. */
  id: string | null;
  email: string;
}

export const SYSTEM_ACTOR: AuditActor = { id: null, email: "system" };

export function actorFromUser(user: Pick<AuthUser, "id" | "email">): AuditActor {
  return { id: user.id, email: user.email };
}

export interface AuditEventInput {
  actor: AuditActor;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  /** Must never contain PII values. */
  metadata?: Record<string, unknown>;
}
