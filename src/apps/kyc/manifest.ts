import type { AppManifest } from "@/platform/apps/types";
import { KYC_PERMISSIONS as P, KYC_RESOURCE_POLICIES, KYC_ROLE_PERMISSIONS } from "./permissions";
import { kycCasePiiResolver } from "./pii";
import { kycHighRiskApprovalRule } from "./rules";

export const kycApp: AppManifest = {
  id: "kyc",
  name: "KYC Review Queue",
  description: "Review customer identity checks: approve, reject or escalate. Risk score 70+ needs a second approver.",
  nav: [{ label: "Review queue", href: "/kyc", permission: P.read }],
  rolePermissions: KYC_ROLE_PERMISSIONS,
  resourcePolicies: KYC_RESOURCE_POLICIES,
  approvalRules: [kycHighRiskApprovalRule],
  piiResolvers: [kycCasePiiResolver],
};
