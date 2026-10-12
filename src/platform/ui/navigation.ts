import { registeredApps } from "@/platform/apps/registry";
import type { AppManifest, AppNavEntry } from "@/platform/apps/types";
import { buildPermissionMatrix, buildResourcePolicies, PLATFORM_PERMISSIONS as P } from "@/platform/rbac/permissions";
import { hasPermission } from "@/platform/rbac/policy";
import type { AuthUser } from "@/platform/rbac/types";

export interface NavSection {
  title: string;
  items: AppNavEntry[];
}

export const PLATFORM_NAV: AppNavEntry[] = [
  { label: "Home", href: "/", permission: P.platformRead },
  { label: "Approvals", href: "/approvals", permission: P.approvalRead },
  { label: "Audit log", href: "/admin/audit", permission: P.auditRead },
];

/** Navigation filtered by permission. Convenience only: every page still checks can(). */
export function buildNavigation(user: AuthUser, apps: readonly AppManifest[] = registeredApps): NavSection[] {
  const config = { matrix: buildPermissionMatrix(apps), resourcePolicies: buildResourcePolicies(apps) };
  const visible = (items: AppNavEntry[]) => items.filter((item) => hasPermission(user, item.permission, config));
  const sections: NavSection[] = [{ title: "Platform", items: visible(PLATFORM_NAV) }];
  for (const app of apps) {
    const items = visible(app.nav);
    if (items.length > 0) sections.push({ title: app.name, items });
  }
  return sections.filter((section) => section.items.length > 0);
}
