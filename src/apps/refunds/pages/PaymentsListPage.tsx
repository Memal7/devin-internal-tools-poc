import Link from "next/link";
import type { Payment } from "@prisma/client";
import { formatMinor } from "@/platform/money";
import { maskPII } from "@/platform/pii/mask";
import { requirePermission } from "@/platform/rbac/enforce";
import { can } from "@/platform/rbac/policy";
import { DataTable, type Column } from "@/platform/ui/DataTable";
import { PageHeader } from "@/platform/ui/PageHeader";
import { parseTableParams, type SearchParams } from "@/platform/ui/table-params";
import { RefundStatusBadge } from "../components/RefundStatusBadge";
import { utcDateTime } from "../format";
import { listPayments, PAYMENT_FILTERS, PAYMENT_SORTABLE, refundableMinor } from "../payments";

function buildColumns(canRequest: boolean): Column<Payment>[] {
  return [
    { key: "reference", header: "Reference", sortable: true, render: (p) => <code className="text-xs">{p.reference}</code> },
    { key: "customer", header: "Customer", render: (p) => <span className="font-mono">{maskPII(p.customerName, "name")}</span> },
    { key: "amountMinor", header: "Amount", sortable: true, className: "text-right font-mono whitespace-nowrap", render: (p) => formatMinor(p.amountMinor, p.currency) },
    { key: "refundedMinor", header: "Refunded / reserved", className: "text-right font-mono whitespace-nowrap", render: (p) => formatMinor(p.refundedMinor, p.currency) },
    { key: "status", header: "Status", sortable: true, render: (p) => <RefundStatusBadge status={p.status} /> },
    { key: "createdAt", header: "Created (UTC)", sortable: true, className: "whitespace-nowrap", render: (p) => utcDateTime(p.createdAt) },
    {
      key: "actions",
      header: "",
      render: (p) =>
        canRequest && p.status === "succeeded" && refundableMinor(p) > 0 ? (
          <Link href={`/refunds/new?paymentId=${p.id}`} className="text-sky-700 hover:underline">
            Request refund
          </Link>
        ) : null,
    },
  ];
}

export default async function PaymentsListPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePermission("read", { type: "payment" });
  const params = parseTableParams(await searchParams, {
    sortable: PAYMENT_SORTABLE,
    defaultSort: { field: "createdAt", direction: "desc" },
    filters: PAYMENT_FILTERS,
  });
  const { rows, total } = await listPayments(user, params);
  return (
    <div>
      <PageHeader title="Payments" description="Pick a succeeded payment to refund. Customer names are masked." />
      <DataTable
        basePath="/refunds/payments"
        columns={buildColumns(can(user, "create", { type: "refund" }))}
        rows={rows}
        total={total}
        params={params}
        filters={PAYMENT_FILTERS}
        rowKey={(p) => p.id}
      />
    </div>
  );
}
