import Link from "next/link";
import { registeredApps } from "@/platform/apps/registry";
import { requirePermission } from "@/platform/rbac/enforce";
import { PLATFORM_PERMISSIONS as P } from "@/platform/rbac/permissions";
import { hasPermission } from "@/platform/rbac/policy";
import { ROLE_DESCRIPTIONS } from "@/platform/rbac/roles";
import { PageHeader } from "@/platform/ui/PageHeader";
import { homeAppCards } from "./home-apps";

export default async function HomePage() {
  const user = await requirePermission("read", { type: "platform" });
  const modules = [
    { title: "Approvals", href: "/approvals", text: "Four-eyes approval requests with threshold rules.", permission: P.approvalRead },
    { title: "Audit log", href: "/admin/audit", text: "Append-only history of every change.", permission: P.auditRead },
  ].filter((m) => hasPermission(user, m.permission));
  const apps = homeAppCards(user);

  return (
    <div className="space-y-8">
      <PageHeader title={`Welcome, ${user.name}`} description="Platform layer for governed internal tools." />
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-700">Your roles</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {user.roles.map((role) => (
            <li key={role}>
              <span className="font-medium">{role}</span>: {ROLE_DESCRIPTIONS[role]}
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Platform</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {modules.map((m) => (
            <Link key={m.href} href={m.href} className="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400">
              <p className="font-medium">{m.title}</p>
              <p className="text-sm text-slate-600">{m.text}</p>
            </Link>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Apps</h2>
        {apps.length === 0 ? (
          <p className="text-sm text-slate-500">
            {registeredApps.length === 0 ? "No business apps registered yet. Apps register in src/platform/apps/registry.ts." : "No apps available for your roles."}
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {apps.map((app) => (
              <Link key={app.id} href={app.href} className="rounded-lg border border-slate-200 bg-white p-5 hover:border-slate-400" data-testid="home-app-card">
                <p className="font-medium">{app.name}</p>
                <p className="text-sm text-slate-600">{app.description}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
