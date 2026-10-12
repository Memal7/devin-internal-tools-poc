import type { ApprovalRule } from "@/platform/approvals/rules";

export const KYC_CASE_ENTITY = "KycCase";

/** Approving a case with a risk score at or above this needs a second person (four-eyes). */
export const HIGH_RISK_THRESHOLD = 70;

export function isHighRisk(riskScore: number): boolean {
  return riskScore >= HIGH_RISK_THRESHOLD;
}

/**
 * Platform approval rule for high-risk approvals. Risk is not an amount, so the rule always
 * applies: the KYC service only requests approval when `isHighRisk(riskScore)`.
 */
export const kycHighRiskApprovalRule: ApprovalRule = {
  key: "kyc.high-risk-approval",
  description: `Approving a KYC case with a risk score of ${HIGH_RISK_THRESHOLD} or more needs a second person (approver) to confirm.`,
  entityType: KYC_CASE_ENTITY,
  requiresApproval: () => true,
};
