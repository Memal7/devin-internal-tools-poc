import Link from "next/link";
import type { ApprovalRequest } from "@prisma/client";
import { APPROVAL_FILTERS, APPROVAL_SORTABLE, listApprovalRequests } from "@/platform/approvals/queries";
import { formatMinor } from "@/platform/money";
import { requirePermission } from "@/platform/rbac/enforce";
import { can } from "@/platform/rbac/policy";
import { DataTable, type Column } from "@/platform/ui/DataTable";
import { PageHeader } from "@/platform/ui/PageHeader";
import { StatusBadge } from "@/platform/ui/StatusBadge";
import { parseTableParams, type SearchParams } from "@/platform/ui/table-params";

const columns: Column<ApprovalRequest>[] = [
  { key: "summary", header: "Summary", render: (r) => <Link href={`/approvals/${r.id}`} className="text-sky-700 hover:underline">{r.summary}</Link> },
  { key: "amountMinor", header: "Amount", sortable: true, className: "text-right font-mono", render: (r) => (r.amountMinor !== null && r.currency ? formatMinor(r.amountMinor, r.currency) : "—") },
  { key: "status", header: "Status", sortable: true, render: (r) => <StatusBadge status={r.status} /> },
  { key: "requesterEmail", header: "Requested by", render: (r) => r.requesterEmail },
  { key: "ruleKey", header: "Rule", render: (r) => <code className="text-xs">{r.ruleKey}</code> },
  { key: "createdAt", header: "Created (UTC)", sortable: true, render: (r) => r.createdAt.toISOString().replace("T", " ").slice(0, 19) },
];

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePermission("read", { type: "approval" });
  const params = parseTableParams(await searchParams, {
    sortable: APPROVAL_SORTABLE,
    defaultSort: { field: "createdAt", direction: "desc" },
    filters: APPROVAL_FILTERS,
  });
  const { rows, total } = await listApprovalRequests(user, params);
  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Generic four-eyes approval requests. The requester can never decide their own request."
        actions={
          can(user, "create", { type: "approval" }) ? (
            <Link href="/approvals/new" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">
              New demo request
            </Link>
          ) : null
        }
      />
      <DataTable basePath="/approvals" columns={columns} rows={rows} total={total} params={params} filters={APPROVAL_FILTERS} rowKey={(r) => r.id} />
    </div>
  );
}
