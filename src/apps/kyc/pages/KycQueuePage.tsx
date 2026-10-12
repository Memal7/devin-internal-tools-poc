import type { KycCase } from "@prisma/client";
import Link from "next/link";
import { requirePermission } from "@/platform/rbac/enforce";
import { DataTable, type Column } from "@/platform/ui/DataTable";
import { PageHeader } from "@/platform/ui/PageHeader";
import { parseTableParams, type SearchParams } from "@/platform/ui/table-params";
import { KycStatusBadge, RiskScore } from "../components/KycStatusBadge";
import { utcDateTime } from "../format";
import { buildKycFilters, KYC_SORTABLE, listAnalystOptions, listKycCases } from "../queries";
import { isHighRisk, kycHighRiskApprovalRule } from "../rules";
import { syncDecidedKycCases } from "../service";
import { documentTypeLabel } from "../status";

const columns: Column<KycCase>[] = [
  { key: "reference", header: "Case", render: (c) => <Link href={`/kyc/${c.id}`} className="font-mono text-xs text-sky-700 hover:underline">{c.reference}</Link> },
  { key: "customerName", header: "Customer", className: "font-mono", render: (c) => c.customerName },
  { key: "country", header: "Country", render: (c) => c.country },
  { key: "documentType", header: "Document", render: (c) => documentTypeLabel(c.documentType) },
  { key: "riskScore", header: "Risk score", sortable: true, render: (c) => <RiskScore score={c.riskScore} highRisk={isHighRisk(c.riskScore)} /> },
  {
    key: "status",
    header: "Status",
    render: (c) => (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <KycStatusBadge status={c.status} />
        {c.status === "in_review" && c.approvalRequestId && <span className="text-xs text-amber-700">awaiting 2nd approver</span>}
      </span>
    ),
  },
  { key: "assignedAnalystEmail", header: "Assigned analyst", render: (c) => c.assignedAnalystEmail ?? <span className="text-slate-400">—</span> },
  { key: "createdAt", header: "Created (UTC)", sortable: true, render: (c) => utcDateTime(c.createdAt) },
];

export default async function KycQueuePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePermission("read", { type: "kyc" });
  await syncDecidedKycCases();
  const filters = buildKycFilters(await listAnalystOptions(user));
  const params = parseTableParams(await searchParams, {
    sortable: KYC_SORTABLE,
    defaultSort: { field: "riskScore", direction: "desc" },
    filters,
  });
  const { rows, total } = await listKycCases(user, params);
  return (
    <div>
      <PageHeader title="KYC review queue" description={`Claim a pending case, then approve, reject or escalate it with a reason. ${kycHighRiskApprovalRule.description}`} />
      <DataTable basePath="/kyc" columns={columns} rows={rows} total={total} params={params} filters={filters} rowKey={(c) => c.id} emptyMessage="No cases match these filters." />
    </div>
  );
}
