import type { ReactNode } from "react";
import { requirePermission } from "@/platform/rbac/enforce";
import { AppShell } from "@/platform/ui/AppShell";

export default async function PlatformLayout({ children }: { children: ReactNode }) {
  const user = await requirePermission("read", { type: "platform" });
  return <AppShell user={user}>{children}</AppShell>;
}
