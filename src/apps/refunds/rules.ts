import { amountThresholdRule } from "@/platform/approvals/rules";

export const REFUND_ENTITY = "Refund";
export const PAYMENT_ENTITY = "Payment";

/** Refunds up to and including this amount are auto-approved. */
export const AUTO_APPROVE_LIMIT_MINOR = { EUR: 50_000 } as const;

/**
 * amountThresholdRule requires approval for amounts >= threshold, so the threshold is one
 * cent above the auto-approve limit. Currencies without a threshold always need approval.
 */
export const refundApprovalRule = amountThresholdRule({
  key: "refunds.refund",
  description: "Refunds above 500.00 EUR need a second person to approve (other currencies always do).",
  entityType: REFUND_ENTITY,
  thresholdsMinor: Object.fromEntries(Object.entries(AUTO_APPROVE_LIMIT_MINOR).map(([currency, limit]) => [currency, limit + 1])),
});
