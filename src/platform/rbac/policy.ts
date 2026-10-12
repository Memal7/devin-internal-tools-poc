import { registeredApps } from "@/platform/apps/registry";
import {
  buildPermissionMatrix,
  buildResourcePolicies,
  type PermissionMatrix,
} from "./permissions";
import { isRole } from "./roles";
import type { AuthUser, Permission, Resource, ResourcePolicy } from "./types";

export interface PolicyConfig {
  matrix: PermissionMatrix;
  resourcePolicies: Partial<Record<Permission, ResourcePolicy[]>>;
}

const defaultConfig: PolicyConfig = {
  matrix: buildPermissionMatrix(registeredApps),
  resourcePolicies: buildResourcePolicies(registeredApps),
};

export function permissionFor(action: string, resource: Resource): Permission {
  return `${resource.type}:${action}`;
}

export function hasPermission(
  user: AuthUser | null | undefined,
  permission: Permission,
  config: PolicyConfig = defaultConfig,
): boolean {
  if (!user) return false;
  return user.roles.some((role) => isRole(role) && config.matrix[role].has(permission));
}

/**
 * The single policy decision point. Deny by default: returns true only when one of
 * the user's roles grants `<resource.type>:<action>` AND every resource policy registered
 * for that permission allows it.
 */
export function can(
  user: AuthUser | null | undefined,
  action: string,
  resource: Resource,
  config: PolicyConfig = defaultConfig,
): boolean {
  if (!user || !action || !resource?.type) return false;
  const permission = permissionFor(action, resource);
  if (!hasPermission(user, permission, config)) return false;
  const policies = config.resourcePolicies[permission] ?? [];
  return policies.every((policy) => policy(user, resource));
}
