import Link from "next/link";
import { notFound } from "next/navigation";
import type { AuditEvent } from "@prisma/client";
import { APPROVAL_ENTITY } from "@/platform/approvals/service";
import { listEntityHistory } from "@/platform/audit/queries";
import { NotFoundError } from "@/platform/errors";
import { formatMinor } from "@/platform/money";
import { maskPII } from "@/platform/pii/mask";
import { MaskedValue } from "@/platform/pii/MaskedValue";
import { requirePermission } from "@/platform/rbac/enforce";
import { PLATFORM_PERMISSIONS } from "@/platform/rbac/permissions";
import { can, hasPermission } from "@/platform/rbac/policy";
import { PageHeader } from "@/platform/ui/PageHeader";
import { StatusBadge } from "@/platform/ui/StatusBadge";
import { RefundDecisionForm } from "../components/RefundDecisionForm";
import { RefundStatusBadge } from "../components/RefundStatusBadge";
import { shortId, utcDateTime } from "../format";
import { refundableMinor } from "../payments";
import { REFUND_PERMISSIONS, refundResource } from "../permissions";
import { getRefund } from "../queries";
import { PAYMENT_ENTITY, REFUND_ENTITY } from "../rules";
import { findRefundApprovalRequest, syncDecidedRefunds } from "../service";
import { REFUND_STATUS_LABELS, type RefundStatus } from "../status";

function refundIdOf(event: AuditEvent): string | undefined {
  if (!event.metadata) return undefined;
  const metadata = JSON.parse(event.metadata) as { refundId?: unknown };
  return typeof metadata.refundId === "string" ? metadata.refundId : undefined;
}

function statusOf(snapshot: string | null): string | undefined {
  if (!snapshot) return undefined;
  const value = (JSON.parse(snapshot) as { status?: unknown }).status;
  return typeof value === "string" ? value : undefined;
}

export default async function RefundDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("read", { type: "refund", id });
  await syncDecidedRefunds([id]);
  const refund = await getRefund(user, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const { payment } = refund;
  const approval = await findRefundApprovalRequest(refund.id);
  const [refundEvents, approvalEvents, paymentEvents] = await Promise.all([
    listEntityHistory(REFUND_ENTITY, refund.id),
    approval ? listEntityHistory(APPROVAL_ENTITY, approval.id) : Promise.resolve([]),
    listEntityHistory(PAYMENT_ENTITY, payment.id),
  ]);
  const history = [...refundEvents, ...approvalEvents, ...paymentEvents.filter((e) => refundIdOf(e) === refund.id)].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );

  const isOwnRequest = refund.requestedById === user.id;
  const showDecision = refund.status === "requested" && hasPermission(user, REFUND_PERMISSIONS.refundDecide);
  const canReveal = can(user, "reveal", { type: "pii", id: payment.id });
  const canSeeApprovals = hasPermission(user, PLATFORM_PERMISSIONS.approvalRead);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={`Refund ${shortId(refund.id)}`}
        description={REFUND_STATUS_LABELS[refund.status as RefundStatus] ?? refund.status}
        actions={<Link href="/refunds" className="text-sm text-sky-700 hover:underline">Back to refunds</Link>}
      />

      <dl className="grid grid-cols-3 gap-x-4 gap-y-3 rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <dt className="text-slate-500">Status</dt>
        <dd className="col-span-2"><RefundStatusBadge status={refund.status} /></dd>
        <dt className="text-slate-500">Amount</dt>
        <dd className="col-span-2 font-mono">{formatMinor(refund.amountMinor, refund.currency)}</dd>
        <dt className="text-slate-500">Reason</dt>
        <dd className="col-span-2 whitespace-pre-wrap">{refund.reason}</dd>
        <dt className="text-slate-500">Requested by</dt>
        <dd className="col-span-2">{refund.requestedByEmail} at {utcDateTime(refund.createdAt)} UTC</dd>
        <dt className="text-slate-500">Decided by</dt>
        <dd className="col-span-2">
          {refund.decidedAt ? `${refund.decidedByEmail ?? "—"} at ${utcDateTime(refund.decidedAt)} UTC` : "—"}
        </dd>
        {refund.decisionReason && (
          <>
            <dt className="text-slate-500">Decision reason</dt>
            <dd className="col-span-2">{refund.decisionReason}</dd>
          </>
        )}
      </dl>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Payment</h2>
        <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">Reference</dt>
          <dd className="col-span-2"><code className="text-xs">{payment.reference}</code></dd>
          <dt className="text-slate-500">Customer</dt>
          <dd className="col-span-2">
            <MaskedValue masked={maskPII(payment.customerName, "name")} entityType={PAYMENT_ENTITY} entityId={payment.id} field="customerName" canReveal={canReveal} />
          </dd>
          <dt className="text-slate-500">Payment amount</dt>
          <dd className="col-span-2 font-mono">{formatMinor(payment.amountMinor, payment.currency)}</dd>
          <dt className="text-slate-500">Refunded / reserved</dt>
          <dd className="col-span-2 font-mono">{formatMinor(payment.refundedMinor, payment.currency)}</dd>
          <dt className="text-slate-500">Still refundable</dt>
          <dd className="col-span-2 font-mono">{formatMinor(refundableMinor(payment), payment.currency)}</dd>
        </dl>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5" data-testid="approval-status">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Approval</h2>
        {approval ? (
          <dl className="grid grid-cols-3 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Approval request</dt>
            <dd className="col-span-2">
              <StatusBadge status={approval.status} />{" "}
              {canSeeApprovals && (
                <Link href={`/approvals/${approval.id}`} className="text-sky-700 hover:underline">
                  View in Approvals
                </Link>
              )}
            </dd>
            <dt className="text-slate-500">Requested by</dt>
            <dd className="col-span-2">{approval.requesterEmail}</dd>
            {approval.deciderEmail && (
              <>
                <dt className="text-slate-500">Decided by</dt>
                <dd className="col-span-2">{approval.deciderEmail}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-sm text-slate-600">
            {refund.status === "auto_approved" ? "Not required: within the 500.00 EUR auto-approve limit." : "No approval request."}
          </p>
        )}
      </section>

      {showDecision && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Decision</h2>
          {isOwnRequest && (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              You requested this refund. Under the four-eyes rule the server will reject your decision; another approver must decide.
            </p>
          )}
          {can(user, "decide", refundResource(refund)) || isOwnRequest ? <RefundDecisionForm refundId={refund.id} /> : null}
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">History (from audit log)</h2>
        <ol className="space-y-2 text-sm" data-testid="refund-history">
          {history.map((event) => {
            const from = statusOf(event.before);
            const to = statusOf(event.after);
            return (
              <li key={event.id} className="flex flex-wrap gap-3">
                <span className="font-mono text-xs text-slate-500">{utcDateTime(event.createdAt)}</span>
                <code className="text-xs font-medium">{event.action}</code>
                <span className="text-slate-600">by {event.actorEmail}</span>
                {to && <span className="text-xs text-slate-500">{from ? `${from} → ${to}` : `→ ${to}`}</span>}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
