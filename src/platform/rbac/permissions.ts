import type { AppManifest } from "@/platform/apps/types";
import { ROLES, type Role } from "./roles";
import type { Permission, ResourcePolicy, RolePermissions } from "./types";

/** Permissions owned by the platform layer. Apps add their own via their manifest. */
export const PLATFORM_PERMISSIONS = {
  platformRead: "platform:read",
  approvalRead: "approval:read",
  approvalCreate: "approval:create",
  approvalDecide: "approval:decide",
  piiReveal: "pii:reveal",
  auditRead: "audit:read",
  userManage: "user:manage",
} as const satisfies Record<string, Permission>;

const P = PLATFORM_PERMISSIONS;

export const PLATFORM_ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  viewer: [P.platformRead, P.approvalRead],
  operator: [P.platformRead, P.approvalRead, P.approvalCreate, P.piiReveal],
  approver: [P.platformRead, P.approvalRead, P.approvalDecide, P.piiReveal],
  admin: [
    P.platformRead,
    P.approvalRead,
    P.approvalCreate,
    P.approvalDecide,
    P.piiReveal,
    P.auditRead,
    P.userManage,
  ],
};

/** Four-eyes: nobody may decide an approval request they created. */
export const PLATFORM_RESOURCE_POLICIES: Partial<Record<Permission, ResourcePolicy>> = {
  [P.approvalDecide]: (user, resource) => {
    const requesterId = resource.attributes?.requesterId;
    return typeof requesterId === "string" && requesterId.length > 0 && requesterId !== user.id;
  },
};

export type PermissionMatrix = Record<Role, ReadonlySet<Permission>>;

export function buildPermissionMatrix(apps: readonly AppManifest[]): PermissionMatrix {
  const sources: RolePermissions[] = [PLATFORM_ROLE_PERMISSIONS, ...apps.map((app) => app.rolePermissions)];
  const matrix = {} as Record<Role, Set<Permission>>;
  for (const role of ROLES) {
    matrix[role] = new Set(sources.flatMap((source) => source[role] ?? []));
  }
  return matrix;
}

export function buildResourcePolicies(
  apps: readonly AppManifest[],
): Partial<Record<Permission, ResourcePolicy[]>> {
  const policies: Partial<Record<Permission, ResourcePolicy[]>> = {};
  const add = (permission: Permission, policy: ResourcePolicy) => {
    (policies[permission] ??= []).push(policy);
  };
  for (const [permission, policy] of Object.entries(PLATFORM_RESOURCE_POLICIES)) {
    if (policy) add(permission as Permission, policy);
  }
  for (const app of apps) {
    for (const [permission, policy] of Object.entries(app.resourcePolicies ?? {})) {
      if (policy) add(permission as Permission, policy);
    }
  }
  return policies;
}
