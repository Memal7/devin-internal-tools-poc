export const KYC_STATUSES = ["pending", "in_review", "approved", "rejected", "escalated"] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const KYC_DECISIONS = ["approve", "reject", "escalate"] as const;
export type KycDecision = (typeof KYC_DECISIONS)[number];

export const DOCUMENT_TYPES = ["passport", "national_id", "driving_licence"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** pending -> in_review (claim) -> approved | rejected | escalated. Decided cases are final. */
const TRANSITIONS: Record<KycStatus, readonly KycStatus[]> = {
  pending: ["in_review"],
  in_review: ["approved", "rejected", "escalated"],
  approved: [],
  rejected: [],
  escalated: [],
};

export function canTransition(from: string, to: KycStatus): boolean {
  return (KYC_STATUSES as readonly string[]).includes(from) && TRANSITIONS[from as KycStatus].includes(to);
}

export const DECISION_TARGET: Record<KycDecision, KycStatus> = {
  approve: "approved",
  reject: "rejected",
  escalate: "escalated",
};

export const KYC_STATUS_LABELS: Record<KycStatus, string> = {
  pending: "Pending",
  in_review: "In review",
  approved: "Approved",
  rejected: "Rejected",
  escalated: "Escalated",
};

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  passport: "Passport",
  national_id: "National ID",
  driving_licence: "Driving licence",
};

export function statusLabel(status: string): string {
  return KYC_STATUS_LABELS[status as KycStatus] ?? status;
}

export function documentTypeLabel(type: string): string {
  return DOCUMENT_TYPE_LABELS[type as DocumentType] ?? type;
}
