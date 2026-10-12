import { z } from "zod";
import { withAudit } from "@/platform/audit/with-audit";
import type { AuditActor } from "@/platform/audit/types";
import { prisma } from "@/platform/db";
import { ROLES, isRole, type Role } from "@/platform/rbac/roles";
import type { AuthUser } from "@/platform/rbac/types";

export const provisionUserSchema = z.object({
  email: z.email().max(200).transform((value) => value.toLowerCase()),
  name: z.string().trim().min(1).max(200),
  roles: z.array(z.enum(ROLES)).max(ROLES.length),
});

/**
 * Creates a user with roles (audited). Used by the seed script and tests.
 * There is no self-service sign-up: OIDC users must be provisioned first.
 */
export async function provisionUser(actor: AuditActor, rawInput: z.input<typeof provisionUserSchema>): Promise<AuthUser> {
  const input = provisionUserSchema.parse(rawInput);
  const roles = [...new Set(input.roles)];
  return withAudit({ actor, action: "user.create", entityType: "User", piiFields: { email: "email", name: "name" } }, async (tx) => {
    const user = await tx.user.create({
      data: { email: input.email, name: input.name, roles: { create: roles.map((role) => ({ role })) } },
    });
    const after = { id: user.id, email: user.email, name: user.name, roles };
    return { entityId: user.id, after, result: { id: user.id, email: user.email, name: user.name, roles } };
  });
}

function toAuthUser(user: { id: string; email: string; name: string; roles: { role: string }[] }): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    roles: user.roles.map((r) => r.role).filter((role): role is Role => isRole(role)),
  };
}

export async function findAuthUserById(id: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { id }, include: { roles: true } });
  return user ? toAuthUser(user) : null;
}

export async function findAuthUserByEmail(email: string): Promise<AuthUser | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() }, include: { roles: true } });
  return user ? toAuthUser(user) : null;
}
