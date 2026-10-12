export const APPROVAL_STATUSES = ["pending", "approved", "declined"] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

const TRANSITIONS: Record<ApprovalStatus, readonly ApprovalStatus[]> = {
  pending: ["approved", "declined"],
  approved: [],
  declined: [],
};

export function canTransition(from: string, to: ApprovalStatus): boolean {
  return (APPROVAL_STATUSES as readonly string[]).includes(from) && TRANSITIONS[from as ApprovalStatus].includes(to);
}
