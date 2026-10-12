"use server";

import { secureAction, type ActionResult } from "@/platform/rbac/enforce";
import { revealPII, revealSchema } from "./reveal";

const reveal = secureAction({
  schema: revealSchema,
  action: "reveal",
  resource: (input) => ({ type: "pii", id: input.entityId, attributes: { entityType: input.entityType, field: input.field } }),
  handler: ({ user, input }) => revealPII(user, input),
});

export async function revealPiiAction(input: unknown): Promise<ActionResult<string>> {
  return reveal(input);
}
