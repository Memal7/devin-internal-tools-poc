import Link from "next/link";
import { formatMinor } from "@/platform/money";
import { maskPII } from "@/platform/pii/mask";
import { requirePermission } from "@/platform/rbac/enforce";
import { can } from "@/platform/rbac/policy";
import { DataTable, type Column } from "@/platform/ui/DataTable";
import { PageHeader } from "@/platform/ui/PageHeader";
import { parseTableParams, type SearchParams } from "@/platform/ui/table-params";
import { RefundStatusBadge } from "../components/RefundStatusBadge";
import { shortId, utcDateTime } from "../format";
import { listRefunds, REFUND_FILTERS, REFUND_SORTABLE, type RefundListRow } from "../queries";
import { syncDecidedRefunds } from "../service";

const columns: Column<RefundListRow>[] = [
  { key: "id", header: "Refund", render: (r) => <Link href={`/refunds/${r.id}`} className="font-mono text-sky-700 hover:underline">{shortId(r.id)}</Link> },
  { key: "payment", header: "Payment", render: (r) => <code className="text-xs">{r.payment.reference}</code> },
  { key: "customer", header: "Customer", render: (r) => <span className="font-mono">{maskPII(r.payment.customerName, "name")}</span> },
  { key: "amountMinor", header: "Amount", sortable: true, className: "text-right font-mono whitespace-nowrap", render: (r) => formatMinor(r.amountMinor, r.currency) },
  { key: "status", header: "Status", sortable: true, render: (r) => <RefundStatusBadge status={r.status} /> },
  { key: "reason", header: "Reason", className: "max-w-xs truncate", render: (r) => r.reason },
  { key: "requestedByEmail", header: "Requested by", render: (r) => r.requestedByEmail },
  { key: "createdAt", header: "Requested (UTC)", sortable: true, className: "whitespace-nowrap", render: (r) => utcDateTime(r.createdAt) },
];

export default async function RefundsListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePermission("read", { type: "refund" });
  const params = parseTableParams(await searchParams, {
    sortable: REFUND_SORTABLE,
    defaultSort: { field: "createdAt", direction: "desc" },
    filters: REFUND_FILTERS,
  });
  await syncDecidedRefunds();
  const { rows, total } = await listRefunds(user, params);
  return (
    <div>
      <PageHeader
        title="Refunds"
        description="Refunds up to 500.00 EUR are auto-approved. Larger refunds need a second person (four-eyes). Amount filters are in EUR, e.g. 500.00."
        actions={
          can(user, "create", { type: "refund" }) ? (
            <Link href="/refunds/payments" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700">
              Request a refund
            </Link>
          ) : null
        }
      />
      <DataTable basePath="/refunds" columns={columns} rows={rows} total={total} params={params} filters={REFUND_FILTERS} rowKey={(r) => r.id} />
    </div>
  );
}
