import type { Role } from "./roles";

/** The authenticated user as seen by the platform. Roles always come from the database. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roles: Role[];
}

/** A permission is `<resource type>:<action>`, e.g. `audit:read` or `pii:reveal`. */
export type Permission = `${string}:${string}`;

export type RolePermissions = Partial<Record<Role, readonly Permission[]>>;

export type ResourceAttributes = Record<string, string | number | boolean | null | undefined>;

export interface Resource {
  type: string;
  id?: string;
  attributes?: ResourceAttributes;
}

/**
 * A resource policy can only further restrict a permission the user already has.
 * It is evaluated after the role check and must return true to allow.
 */
export type ResourcePolicy = (user: AuthUser, resource: Resource) => boolean;
