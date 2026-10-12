const COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-emerald-100 text-emerald-800",
  declined: "bg-red-100 text-red-800",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${COLORS[status] ?? "bg-slate-100 text-slate-700"}`}>{status}</span>;
}
