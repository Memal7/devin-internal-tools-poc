import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/platform/auth/actions";
import type { AuthUser } from "@/platform/rbac/types";
import { buildNavigation } from "./navigation";
import { RoleBadges } from "./RoleBadges";

export function AppShell({ user, children }: { user: AuthUser; children: ReactNode }) {
  const sections = buildNavigation(user);
  return (
    <div className="flex min-h-screen bg-slate-100">
      <aside className="w-60 shrink-0 border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <Link href="/" className="text-base font-semibold text-slate-900">
            Internal Tools Kit
          </Link>
          <p className="text-xs text-slate-500">Governed internal tools</p>
        </div>
        <nav className="space-y-6 px-3 py-4" aria-label="Main">
          {sections.map((section) => (
            <div key={section.title}>
              <p className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{section.title}</p>
              <ul className="mt-2 space-y-1">
                {section.items.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className="block rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-end gap-4 border-b border-slate-200 bg-white px-6 py-3">
          <div className="text-right">
            <p className="text-sm font-medium text-slate-900" data-testid="current-user">
              {user.name} <span className="text-slate-500">({user.email})</span>
            </p>
            <RoleBadges roles={user.roles} />
          </div>
          <form action={signOutAction}>
            <button type="submit" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
              Sign out
            </button>
          </form>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
