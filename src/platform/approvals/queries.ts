import type { Prisma } from "@prisma/client";
import { prisma } from "@/platform/db";
import { assertCan } from "@/platform/rbac/assert";
import type { AuthUser } from "@/platform/rbac/types";
import type { TableParams } from "@/platform/ui/table-params";
import { APPROVAL_STATUSES } from "./status";

export const APPROVAL_SORTABLE = ["createdAt", "amountMinor", "status"] as const;

export const APPROVAL_FILTERS = [
  { name: "status", label: "Status", type: "select", options: APPROVAL_STATUSES.map((s) => ({ value: s, label: s })) },
  { name: "requester", label: "Requester email", type: "text" },
  { name: "ruleKey", label: "Rule", type: "text" },
] as const;

export async function listApprovalRequests(user: AuthUser, params: TableParams) {
  assertCan(user, "read", { type: "approval" });
  const f = params.filters;
  const where: Prisma.ApprovalRequestWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.requester ? { requesterEmail: { contains: f.requester } } : {}),
    ...(f.ruleKey ? { ruleKey: { contains: f.ruleKey } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.approvalRequest.findMany({
      where,
      orderBy: [{ [params.sort.field]: params.sort.direction }, { id: "asc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.approvalRequest.count({ where }),
  ]);
  return { rows, total };
}
