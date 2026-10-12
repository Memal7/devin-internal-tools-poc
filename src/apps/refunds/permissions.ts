import type { Refund } from "@prisma/client";
import type { Permission, Resource, ResourcePolicy, RolePermissions } from "@/platform/rbac/types";

/** Permissions owned by the refunds app, registered through its manifest. */
export const REFUND_PERMISSIONS = {
  paymentRead: "payment:read",
  refundRead: "refund:read",
  refundCreate: "refund:create",
  refundDecide: "refund:decide",
} as const satisfies Record<string, Permission>;

const P = REFUND_PERMISSIONS;

export const REFUND_ROLE_PERMISSIONS: RolePermissions = {
  viewer: [P.paymentRead, P.refundRead],
  operator: [P.paymentRead, P.refundRead, P.refundCreate],
  approver: [P.paymentRead, P.refundRead, P.refundDecide],
  admin: [P.paymentRead, P.refundRead, P.refundCreate, P.refundDecide],
};

/** Four-eyes: nobody may decide a refund they requested. */
export const REFUND_RESOURCE_POLICIES: Partial<Record<Permission, ResourcePolicy>> = {
  [P.refundDecide]: (user, resource) => {
    const requestedById = resource.attributes?.requestedById;
    return typeof requestedById === "string" && requestedById.length > 0 && requestedById !== user.id;
  },
};

export function refundResource(refund?: Pick<Refund, "id" | "requestedById">): Resource {
  return refund
    ? { type: "refund", id: refund.id, attributes: { requestedById: refund.requestedById } }
    : { type: "refund" };
}
