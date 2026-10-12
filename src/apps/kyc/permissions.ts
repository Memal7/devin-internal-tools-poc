import type { KycCase } from "@prisma/client";
import type { Permission, Resource, ResourcePolicy, RolePermissions } from "@/platform/rbac/types";

/** Permissions owned by the KYC app, registered through its manifest. Resource type: `kyc`. */
export const KYC_PERMISSIONS = {
  read: "kyc:read",
  claim: "kyc:claim",
  decide: "kyc:decide",
  confirm: "kyc:confirm",
} as const satisfies Record<string, Permission>;

const P = KYC_PERMISSIONS;

export const KYC_ROLE_PERMISSIONS: RolePermissions = {
  viewer: [P.read],
  operator: [P.read, P.claim, P.decide],
  approver: [P.read, P.confirm],
  admin: [P.read, P.claim, P.decide, P.confirm],
};

export const KYC_RESOURCE_POLICIES: Partial<Record<Permission, ResourcePolicy>> = {
  /** Only the analyst assigned to the case may approve, reject or escalate it. */
  [P.decide]: (user, resource) => {
    const assignedAnalystId = resource.attributes?.assignedAnalystId;
    return typeof assignedAnalystId === "string" && assignedAnalystId.length > 0 && assignedAnalystId === user.id;
  },
  /** Four-eyes: nobody may confirm a high-risk approval they requested. */
  [P.confirm]: (user, resource) => {
    const requesterId = resource.attributes?.approvalRequesterId;
    return typeof requesterId === "string" && requesterId.length > 0 && requesterId !== user.id;
  },
};

export function kycCaseResource(
  kycCase?: Pick<KycCase, "id" | "assignedAnalystId">,
  approvalRequesterId?: string | null,
): Resource {
  if (!kycCase) return { type: "kyc" };
  return {
    type: "kyc",
    id: kycCase.id,
    attributes: { assignedAnalystId: kycCase.assignedAnalystId, approvalRequesterId: approvalRequesterId ?? null },
  };
}
