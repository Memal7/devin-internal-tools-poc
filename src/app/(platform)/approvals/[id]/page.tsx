import Link from "next/link";
import { notFound } from "next/navigation";
import { DecisionForm } from "@/platform/approvals/DecisionForm";
import { getApprovalRule } from "@/platform/approvals/registry";
import { APPROVAL_ENTITY, approvalResource, getApprovalRequest } from "@/platform/approvals/service";
import { listEntityHistory } from "@/platform/audit/queries";
import { NotFoundError } from "@/platform/errors";
import { formatMinor } from "@/platform/money";
import { maskPII } from "@/platform/pii/mask";
import { MaskedValue } from "@/platform/pii/MaskedValue";
import { requirePermission } from "@/platform/rbac/enforce";
import { PLATFORM_PERMISSIONS as P } from "@/platform/rbac/permissions";
import { can, hasPermission } from "@/platform/rbac/policy";
import { PageHeader } from "@/platform/ui/PageHeader";
import { StatusBadge } from "@/platform/ui/StatusBadge";

export default async function ApprovalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("read", { type: "approval", id });
  const request = await getApprovalRequest(user, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const rule = getApprovalRule(request.ruleKey);
  const payload = JSON.parse(request.payload) as Record<string, unknown>;
  const piiFields = rule?.payloadPiiFields ?? {};
  const canReveal = can(user, "reveal", { type: "pii", id: request.id });
  const history = await listEntityHistory(APPROVAL_ENTITY, request.id);
  const isOwnRequest = request.requesterId === user.id;
  const showDecision = request.status === "pending" && hasPermission(user, P.approvalDecide);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title={request.summary} description={rule?.description} actions={<Link href="/approvals" className="text-sm text-sky-700 hover:underline">Back to approvals</Link>} />
      <dl className="grid grid-cols-3 gap-x-4 gap-y-3 rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <dt className="text-slate-500">Status</dt>
        <dd className="col-span-2"><StatusBadge status={request.status} /></dd>
        <dt className="text-slate-500">Amount</dt>
        <dd className="col-span-2 font-mono">{request.amountMinor !== null && request.currency ? formatMinor(request.amountMinor, request.currency) : "—"}</dd>
        <dt className="text-slate-500">Requested by</dt>
        <dd className="col-span-2">{request.requesterEmail}</dd>
        <dt className="text-slate-500">Entity</dt>
        <dd className="col-span-2"><code className="text-xs">{request.entityType} / {request.entityId}</code></dd>
        {Object.entries(payload).map(([key, value]) => {
          const kind = piiFields[key];
          const text = typeof value === "string" ? value : JSON.stringify(value);
          return (
            <div key={key} className="contents">
              <dt className="text-slate-500">{key}</dt>
              <dd className="col-span-2">
                {kind ? (
                  <MaskedValue masked={maskPII(text, kind)} entityType={APPROVAL_ENTITY} entityId={request.id} field={`payload.${key}`} canReveal={canReveal} />
                ) : (
                  text
                )}
              </dd>
            </div>
          );
        })}
        {request.deciderEmail && (
          <>
            <dt className="text-slate-500">Decided by</dt>
            <dd className="col-span-2">{request.deciderEmail} at {request.decidedAt?.toISOString()}</dd>
            <dt className="text-slate-500">Reason</dt>
            <dd className="col-span-2">{request.decisionReason ?? "—"}</dd>
          </>
        )}
      </dl>

      {showDecision && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Decision</h2>
          {isOwnRequest && (
            <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
              You created this request. Under the four-eyes rule the server will reject your decision; another approver must decide.
            </p>
          )}
          {can(user, "decide", approvalResource(request)) || isOwnRequest ? <DecisionForm requestId={request.id} /> : null}
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">History (from audit log)</h2>
        <ol className="space-y-2 text-sm">
          {history.map((event) => (
            <li key={event.id} className="flex gap-3">
              <span className="font-mono text-xs text-slate-500">{event.createdAt.toISOString().replace("T", " ").slice(0, 19)}</span>
              <span className="font-medium">{event.action}</span>
              <span className="text-slate-600">by {event.actorEmail}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
