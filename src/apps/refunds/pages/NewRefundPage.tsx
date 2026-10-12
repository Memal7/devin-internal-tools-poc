import Link from "next/link";
import { NotFoundError } from "@/platform/errors";
import { formatMinor } from "@/platform/money";
import { maskPII } from "@/platform/pii/mask";
import { requirePermission } from "@/platform/rbac/enforce";
import { EntityForm, type FieldDef } from "@/platform/ui/EntityForm";
import { PageHeader } from "@/platform/ui/PageHeader";
import type { SearchParams } from "@/platform/ui/table-params";
import { requestRefundAction } from "../actions";
import { RefundStatusBadge } from "../components/RefundStatusBadge";
import { getPayment, refundableMinor } from "../payments";
import { refundApprovalRule } from "../rules";

function buildFields(paymentId: string): FieldDef[] {
  return [
    { name: "paymentId", label: "Payment ID", type: "text", required: true, defaultValue: paymentId, help: "Pick a payment on the Payments page." },
    { name: "amount", label: "Refund amount", type: "text", inputMode: "decimal", required: true, placeholder: "120.50", help: "Up to 500.00 EUR is auto-approved; above that a second person must approve." },
    { name: "reason", label: "Reason", type: "textarea", required: true, placeholder: "Customer returned the goods" },
  ];
}

export default async function NewRefundPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const user = await requirePermission("create", { type: "refund" });
  const raw = (await searchParams).paymentId;
  const paymentId = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 100) ?? "";
  const payment = paymentId
    ? await getPayment(user, paymentId).catch((error: unknown) => {
        if (error instanceof NotFoundError) return null;
        throw error;
      })
    : null;

  return (
    <div className="max-w-xl space-y-6">
      <PageHeader
        title="Request a refund"
        description={refundApprovalRule.description}
        actions={<Link href="/refunds/payments" className="text-sm text-sky-700 hover:underline">Back to payments</Link>}
      />
      {payment && (
        <dl className="grid grid-cols-3 gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white p-5 text-sm" data-testid="payment-summary">
          <dt className="text-slate-500">Payment</dt>
          <dd className="col-span-2"><code className="text-xs">{payment.reference}</code> <RefundStatusBadge status={payment.status} /></dd>
          <dt className="text-slate-500">Customer</dt>
          <dd className="col-span-2 font-mono">{maskPII(payment.customerName, "name")}</dd>
          <dt className="text-slate-500">Amount</dt>
          <dd className="col-span-2 font-mono">{formatMinor(payment.amountMinor, payment.currency)}</dd>
          <dt className="text-slate-500">Still refundable</dt>
          <dd className="col-span-2 font-mono">{formatMinor(refundableMinor(payment), payment.currency)}</dd>
        </dl>
      )}
      {paymentId && !payment && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">Payment not found.</p>}
      <EntityForm fields={buildFields(payment?.id ?? paymentId)} action={requestRefundAction} submitLabel="Request refund" />
    </div>
  );
}
