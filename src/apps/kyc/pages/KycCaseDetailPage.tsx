import type { AuditEvent } from "@prisma/client";
import Link from "next/link";
import { notFound } from "next/navigation";
import { APPROVAL_ENTITY } from "@/platform/approvals/service";
import { listEntityHistory } from "@/platform/audit/queries";
import { NotFoundError } from "@/platform/errors";
import { MaskedValue } from "@/platform/pii/MaskedValue";
import { requirePermission } from "@/platform/rbac/enforce";
import { PLATFORM_PERMISSIONS } from "@/platform/rbac/permissions";
import { can, hasPermission } from "@/platform/rbac/policy";
import { EntityForm, type FieldDef } from "@/platform/ui/EntityForm";
import { PageHeader } from "@/platform/ui/PageHeader";
import { StatusBadge } from "@/platform/ui/StatusBadge";
import { claimKycCaseAction, confirmKycApprovalAction, decideKycCaseAction } from "../actions";
import { KycStatusBadge, RiskScore } from "../components/KycStatusBadge";
import { utcDateTime } from "../format";
import { KYC_PERMISSIONS, kycCaseResource } from "../permissions";
import { getKycCase, listKycApprovalRequests } from "../queries";
import { HIGH_RISK_THRESHOLD, isHighRisk, KYC_CASE_ENTITY } from "../rules";
import { syncDecidedKycCases } from "../service";
import { documentTypeLabel, statusLabel } from "../status";

function decisionFields(highRisk: boolean): FieldDef[] {
  return [
    {
      name: "decision",
      label: "Decision",
      type: "select",
      required: true,
      defaultValue: "",
      options: [
        { value: "", label: "Choose…" },
        { value: "approve", label: highRisk ? "Approve (needs a second approver)" : "Approve" },
        { value: "reject", label: "Reject" },
        { value: "escalate", label: "Escalate" },
      ],
      help: highRisk ? `Risk score ${HIGH_RISK_THRESHOLD}+: approving creates a request that a different approver must confirm.` : undefined,
    },
    { name: "reason", label: "Reason", type: "textarea", required: true, placeholder: "Documents verified against the registry" },
  ];
}

const CONFIRM_FIELDS: FieldDef[] = [
  {
    name: "decision",
    label: "Decision",
    type: "select",
    required: true,
    defaultValue: "",
    options: [
      { value: "", label: "Choose…" },
      { value: "confirm", label: "Confirm approval" },
      { value: "decline", label: "Decline (back to the analyst)" },
    ],
  },
  { name: "reason", label: "Reason", type: "textarea", help: "Required to decline." },
];

function statusOf(snapshot: string | null): string | undefined {
  if (!snapshot) return undefined;
  const value = (JSON.parse(snapshot) as { status?: unknown }).status;
  return typeof value === "string" ? value : undefined;
}

function byTime(a: AuditEvent, b: AuditEvent) {
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

export default async function KycCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePermission("read", { type: "kyc", id });
  await syncDecidedKycCases([id]);
  const kycCase = await getKycCase(user, id).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  const approvals = await listKycApprovalRequests(user, kycCase.id);
  const pendingApproval = kycCase.approvalRequestId ? (approvals.find((a) => a.id === kycCase.approvalRequestId) ?? null) : null;
  const [caseEvents, ...approvalEvents] = await Promise.all([
    listEntityHistory(KYC_CASE_ENTITY, kycCase.id),
    ...approvals.map((a) => listEntityHistory(APPROVAL_ENTITY, a.id)),
  ]);
  const history = [...caseEvents, ...approvalEvents.flat()].sort(byTime);

  const highRisk = isHighRisk(kycCase.riskScore);
  const canReveal = can(user, "reveal", { type: "pii", id: kycCase.id });
  const canSeeApprovals = hasPermission(user, PLATFORM_PERMISSIONS.approvalRead);
  const showClaim = kycCase.status === "pending" && can(user, "claim", kycCaseResource(kycCase));
  const showDecide = kycCase.status === "in_review" && !kycCase.approvalRequestId && can(user, "decide", kycCaseResource(kycCase));
  const awaitingConfirmation = kycCase.status === "in_review" && pendingApproval?.status === "pending";
  const showConfirm = awaitingConfirmation && can(user, "confirm", kycCaseResource(kycCase, pendingApproval.requesterId));
  const ownApprovalRequest = awaitingConfirmation && pendingApproval.requesterId === user.id;
  const assignedToOther =
    kycCase.status === "in_review" && kycCase.assignedAnalystId !== user.id && hasPermission(user, KYC_PERMISSIONS.decide);

  const pii = (field: "customerName" | "dateOfBirth" | "documentNumber") => (
    <MaskedValue masked={kycCase[field]} entityType={KYC_CASE_ENTITY} entityId={kycCase.id} field={field} canReveal={canReveal} />
  );

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title={`KYC case ${kycCase.reference}`}
        description={statusLabel(kycCase.status)}
        actions={<Link href="/kyc" className="text-sm text-sky-700 hover:underline">Back to queue</Link>}
      />

      <dl className="grid grid-cols-3 gap-x-4 gap-y-3 rounded-lg border border-slate-200 bg-white p-5 text-sm">
        <dt className="text-slate-500">Status</dt>
        <dd className="col-span-2"><KycStatusBadge status={kycCase.status} /></dd>
        <dt className="text-slate-500">Customer name</dt>
        <dd className="col-span-2">{pii("customerName")}</dd>
        <dt className="text-slate-500">Date of birth</dt>
        <dd className="col-span-2">{pii("dateOfBirth")}</dd>
        <dt className="text-slate-500">Document</dt>
        <dd className="col-span-2">{documentTypeLabel(kycCase.documentType)}</dd>
        <dt className="text-slate-500">Document number</dt>
        <dd className="col-span-2">{pii("documentNumber")}</dd>
        <dt className="text-slate-500">Country</dt>
        <dd className="col-span-2">{kycCase.country}</dd>
        <dt className="text-slate-500">Risk score</dt>
        <dd className="col-span-2"><RiskScore score={kycCase.riskScore} highRisk={highRisk} /></dd>
        <dt className="text-slate-500">Assigned analyst</dt>
        <dd className="col-span-2">{kycCase.assignedAnalystEmail ?? "—"}</dd>
        <dt className="text-slate-500">Decision reason</dt>
        <dd className="col-span-2 whitespace-pre-wrap">{kycCase.decisionReason ?? "—"}</dd>
        <dt className="text-slate-500">Created / updated</dt>
        <dd className="col-span-2">{utcDateTime(kycCase.createdAt)} / {utcDateTime(kycCase.updatedAt)} UTC</dd>
      </dl>

      {approvals.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-5" data-testid="approval-status">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Second approval (four-eyes)</h2>
          <ul className="space-y-2 text-sm">
            {approvals.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <StatusBadge status={a.status} />
                <span>requested by {a.requesterEmail}</span>
                {a.deciderEmail && <span>· decided by {a.deciderEmail}{a.decisionReason ? `: ${a.decisionReason}` : ""}</span>}
                {canSeeApprovals && <Link href={`/approvals/${a.id}`} className="text-sky-700 hover:underline">View in Approvals</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(showClaim || showDecide || showConfirm || ownApprovalRequest || assignedToOther) && (
        <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-slate-700">Actions</h2>
          {assignedToOther && <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">Assigned to {kycCase.assignedAnalystEmail}. Only the assigned analyst can decide this case.</p>}
          {ownApprovalRequest && (
            <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="own-request-note">
              You requested this approval. Under the four-eyes rule a different approver must confirm it.
            </p>
          )}
          {showClaim && <EntityForm fields={[]} action={claimKycCaseAction.bind(null, kycCase.id)} submitLabel="Claim case" />}
          {showDecide && <EntityForm fields={decisionFields(highRisk)} action={decideKycCaseAction.bind(null, kycCase.id)} submitLabel="Submit decision" />}
          {showConfirm && <EntityForm fields={CONFIRM_FIELDS} action={confirmKycApprovalAction.bind(null, kycCase.id)} submitLabel="Submit" />}
        </section>
      )}

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">History (from audit log)</h2>
        <ol className="space-y-2 text-sm" data-testid="kyc-history">
          {history.map((event) => {
            const from = statusOf(event.before);
            const to = statusOf(event.after);
            return (
              <li key={event.id} className="flex flex-wrap gap-3">
                <span className="font-mono text-xs text-slate-500">{utcDateTime(event.createdAt)}</span>
                <code className="text-xs font-medium">{event.action}</code>
                <span className="text-slate-600">by {event.actorEmail}</span>
                {to && from !== to && <span className="text-xs text-slate-500">{from ? `${from} → ${to}` : `→ ${to}`}</span>}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
