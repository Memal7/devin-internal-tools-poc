import { registeredApps } from "@/platform/apps/registry";
import type { AppManifest } from "@/platform/apps/types";
import { hasPermission } from "@/platform/rbac/policy";
import type { AuthUser } from "@/platform/rbac/types";

export interface HomeAppCard {
  id: string;
  name: string;
  description: string;
  href: string;
}

/** One card per registered app, linking to the first page the user may open; apps with none are hidden. */
export function homeAppCards(user: AuthUser, apps: readonly AppManifest[] = registeredApps): HomeAppCard[] {
  return apps.flatMap((app) => {
    const entry = app.nav.find((item) => hasPermission(user, item.permission));
    return entry ? [{ id: app.id, name: app.name, description: app.description, href: entry.href }] : [];
  });
}
