import type { PiiFieldMap } from "@/platform/pii/types";

export interface ApprovalSubject {
  amountMinor?: number | null;
  currency?: string | null;
}

export interface ApprovalRule {
  key: string;
  description: string;
  entityType: string;
  /** True when the action needs a second person to approve it. */
  requiresApproval: (subject: ApprovalSubject) => boolean;
  /** PII fields inside the request payload (masked by default, revealable with pii:reveal). */
  payloadPiiFields?: PiiFieldMap;
}

export interface AmountThresholdRuleConfig {
  key: string;
  description: string;
  entityType: string;
  /** Threshold per ISO 4217 currency in integer minor units. Amounts >= threshold need approval. */
  thresholdsMinor: Record<string, number>;
  payloadPiiFields?: PiiFieldMap;
}

/**
 * Amount threshold rule. Fails safe: a missing amount or a currency without a configured
 * threshold always requires approval.
 */
export function amountThresholdRule(config: AmountThresholdRuleConfig): ApprovalRule {
  for (const [currency, threshold] of Object.entries(config.thresholdsMinor)) {
    if (!Number.isInteger(threshold) || threshold < 0) {
      throw new Error(`Invalid threshold for ${currency} in rule ${config.key}`);
    }
  }
  return {
    key: config.key,
    description: config.description,
    entityType: config.entityType,
    payloadPiiFields: config.payloadPiiFields,
    requiresApproval: ({ amountMinor, currency }) => {
      if (amountMinor === null || amountMinor === undefined || !currency) return true;
      const threshold = config.thresholdsMinor[currency.toUpperCase()];
      if (threshold === undefined) return true;
      return amountMinor >= threshold;
    },
  };
}

/** Demo rule so reviewers can exercise the workflow before any business app exists. */
export const demoPaymentRule = amountThresholdRule({
  key: "platform.demo-payment",
  description: "Demo payments of 1,000.00 or more need a second person to approve.",
  entityType: "DemoPayment",
  thresholdsMinor: { EUR: 100_000, USD: 100_000, GBP: 100_000 },
  payloadPiiFields: { beneficiaryName: "name", beneficiaryIban: "iban" },
});
