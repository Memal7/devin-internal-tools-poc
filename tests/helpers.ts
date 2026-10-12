import { randomUUID } from "node:crypto";
import { SYSTEM_ACTOR } from "@/platform/audit/types";
import { provisionUser } from "@/platform/auth/users";
import type { Role } from "@/platform/rbac/roles";
import type { AuthUser } from "@/platform/rbac/types";

export async function createUser(...roles: Role[]): Promise<AuthUser> {
  const label = roles.join("-") || "noroles";
  return provisionUser(SYSTEM_ACTOR, { email: `${label}-${randomUUID()}@test.local`, name: `Test ${label}`, roles });
}

/** In-memory user for pure policy tests (no database). */
export function fakeUser(...roles: Role[]): AuthUser {
  return { id: `user-${randomUUID()}`, email: "fake@test.local", name: "Fake", roles };
}
