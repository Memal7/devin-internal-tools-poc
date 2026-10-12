import type { Role } from "@/platform/rbac/roles";

const COLORS: Record<Role, string> = {
  viewer: "bg-slate-100 text-slate-700",
  operator: "bg-sky-100 text-sky-800",
  approver: "bg-amber-100 text-amber-800",
  admin: "bg-rose-100 text-rose-800",
};

export function RoleBadges({ roles }: { roles: readonly Role[] }) {
  return (
    <span className="inline-flex flex-wrap justify-end gap-1">
      {roles.map((role) => (
        <span key={role} className={`rounded px-1.5 py-0.5 text-xs font-medium ${COLORS[role]}`}>
          {role}
        </span>
      ))}
    </span>
  );
}
