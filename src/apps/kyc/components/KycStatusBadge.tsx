import { statusLabel } from "../status";

const COLORS: Record<string, string> = {
  pending: "bg-slate-100 text-slate-700",
  in_review: "bg-sky-100 text-sky-800",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  escalated: "bg-purple-100 text-purple-800",
};

export function KycStatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${COLORS[status] ?? "bg-slate-100 text-slate-700"}`} data-testid="kyc-status">
      {statusLabel(status)}
    </span>
  );
}

export function RiskScore({ score, highRisk }: { score: number; highRisk: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono">
      {score}
      {highRisk && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-sans text-xs font-medium text-amber-800">high</span>}
    </span>
  );
}
