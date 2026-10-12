import { z } from "zod";
import { recordAuditEvent } from "@/platform/audit/with-audit";
import { actorFromUser } from "@/platform/audit/types";
import { AuthorizationError, NotFoundError } from "@/platform/errors";
import { assertCan } from "@/platform/rbac/assert";
import { can } from "@/platform/rbac/policy";
import type { AuthUser } from "@/platform/rbac/types";
import { getPiiResolver } from "./registry";

export const revealSchema = z.object({
  entityType: z.string().min(1).max(100),
  entityId: z.string().min(1).max(100),
  field: z.string().min(1).max(100),
});

export type RevealInput = z.infer<typeof revealSchema>;

/**
 * Returns the unmasked value of one PII field. Requires `pii:reveal` and read access to
 * the entity. Writes a `pii.reveal` audit event (field name only, never the value).
 */
export async function revealPII(user: AuthUser, rawInput: RevealInput): Promise<string> {
  const input = revealSchema.parse(rawInput);
  assertCan(user, "reveal", {
    type: "pii",
    id: input.entityId,
    attributes: { entityType: input.entityType, field: input.field },
  });
  const resolver = getPiiResolver(input.entityType);
  if (!resolver || !resolver.fields[input.field]) throw new NotFoundError("Unknown field.");
  if (!can(user, resolver.readCheck.action, { type: resolver.readCheck.resourceType, id: input.entityId })) {
    throw new AuthorizationError();
  }
  const value = await resolver.resolve(input.entityId, input.field);
  if (value === null) throw new NotFoundError("Value not found.");
  await recordAuditEvent({
    actor: actorFromUser(user),
    action: "pii.reveal",
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: { field: input.field },
  });
  return value;
}
