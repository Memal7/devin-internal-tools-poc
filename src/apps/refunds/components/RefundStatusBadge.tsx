const COLORS: Record<string, string> = {
  requested: "bg-amber-100 text-amber-800",
  auto_approved: "bg-sky-100 text-sky-800",
  approved: "bg-emerald-100 text-emerald-800",
  declined: "bg-red-100 text-red-800",
  succeeded: "bg-emerald-100 text-emerald-800",
  pending: "bg-amber-100 text-amber-800",
  failed: "bg-red-100 text-red-800",
};

export function RefundStatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${COLORS[status] ?? "bg-slate-100 text-slate-700"}`} data-testid="refund-status">
      {status.replace("_", "-")}
    </span>
  );
}
