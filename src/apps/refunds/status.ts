export const REFUND_STATUSES = ["requested", "auto_approved", "approved", "declined"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const PAYMENT_STATUSES = ["succeeded", "pending", "failed"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  requested: "Requested (awaiting approval)",
  auto_approved: "Auto-approved",
  approved: "Approved",
  declined: "Declined",
};
