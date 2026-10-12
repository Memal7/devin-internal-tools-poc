import type { AppManifest } from "@/platform/apps/types";
import { REFUND_PERMISSIONS as P, REFUND_RESOURCE_POLICIES, REFUND_ROLE_PERMISSIONS } from "./permissions";
import { paymentPiiResolver } from "./pii";
import { refundApprovalRule } from "./rules";

export const refundsApp: AppManifest = {
  id: "refunds",
  name: "Refunds",
  description: "Request refunds for payments. Above 500.00 EUR a second person must approve.",
  nav: [
    { label: "Refunds", href: "/refunds", permission: P.refundRead },
    { label: "Payments", href: "/refunds/payments", permission: P.paymentRead },
    { label: "Request refund", href: "/refunds/new", permission: P.refundCreate },
  ],
  rolePermissions: REFUND_ROLE_PERMISSIONS,
  resourcePolicies: REFUND_RESOURCE_POLICIES,
  approvalRules: [refundApprovalRule],
  piiResolvers: [paymentPiiResolver],
};
