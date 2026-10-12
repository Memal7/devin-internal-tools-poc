import type { ApprovalRule } from "@/platform/approvals/rules";
import type { PiiResolver } from "@/platform/pii/types";
import type { Permission, ResourcePolicy, RolePermissions } from "@/platform/rbac/types";

export interface AppNavEntry {
  label: string;
  href: string;
  /** Shown only if the user has this permission (checked again on the server by the page). */
  permission: Permission;
}

/** What a business app registers with the platform. See src/platform/apps/registry.ts. */
export interface AppManifest {
  id: string;
  name: string;
  description: string;
  nav: AppNavEntry[];
  rolePermissions: RolePermissions;
  resourcePolicies?: Partial<Record<Permission, ResourcePolicy>>;
  approvalRules?: ApprovalRule[];
  piiResolvers?: PiiResolver[];
}
