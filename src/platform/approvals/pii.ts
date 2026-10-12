import { prisma } from "@/platform/db";
import type { PiiFieldMap, PiiResolver } from "@/platform/pii/types";
import { getApprovalRule, listApprovalRules } from "./registry";
import { APPROVAL_ENTITY } from "./service";

const fields: PiiFieldMap = Object.fromEntries(
  listApprovalRules().flatMap((rule) =>
    Object.entries(rule.payloadPiiFields ?? {}).map(([field, kind]) => [`payload.${field}`, kind]),
  ),
);

/** Lets `revealPII()` read PII stored in approval request payloads. */
export const approvalPayloadPiiResolver: PiiResolver = {
  entityType: APPROVAL_ENTITY,
  fields,
  readCheck: { action: "read", resourceType: "approval" },
  resolve: async (entityId, field) => {
    const request = await prisma.approvalRequest.findUnique({ where: { id: entityId } });
    if (!request || !field.startsWith("payload.")) return null;
    const key = field.slice("payload.".length);
    const rule = getApprovalRule(request.ruleKey);
    if (!rule?.payloadPiiFields?.[key]) return null;
    const value = (JSON.parse(request.payload) as Record<string, unknown>)[key];
    return typeof value === "string" ? value : null;
  },
};
