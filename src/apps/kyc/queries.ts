import type { KycCase, Prisma } from "@prisma/client";
import { prisma } from "@/platform/db";
import { NotFoundError } from "@/platform/errors";
import { maskObject } from "@/platform/pii/mask";
import { assertCan } from "@/platform/rbac/assert";
import type { AuthUser } from "@/platform/rbac/types";
import type { FilterDef, FilterOption, TableParams } from "@/platform/ui/table-params";
import { KYC_PII_FIELDS } from "./pii";
import { KYC_CASE_ENTITY, kycHighRiskApprovalRule } from "./rules";
import { KYC_STATUSES, statusLabel } from "./status";

export const KYC_SORTABLE = ["riskScore", "createdAt"] as const;

export const UNASSIGNED = "unassigned";

export function buildKycFilters(analysts: readonly FilterOption[]): FilterDef[] {
  return [
    { name: "status", label: "Status", type: "select", options: KYC_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })) },
    { name: "minRisk", label: "Min risk score", type: "text" },
    { name: "maxRisk", label: "Max risk score", type: "text" },
    { name: "analyst", label: "Assigned analyst", type: "select", options: [{ value: UNASSIGNED, label: "Unassigned" }, ...analysts] },
  ];
}

function riskFilter(value: string | undefined): number | undefined {
  if (!value || !/^\d{1,3}$/.test(value)) return undefined;
  const score = Number(value);
  return score <= 100 ? score : undefined;
}

export function buildKycWhere(filters: TableParams["filters"]): Prisma.KycCaseWhereInput {
  const min = riskFilter(filters.minRisk);
  const max = riskFilter(filters.maxRisk);
  return {
    ...(filters.status ? { status: filters.status } : {}),
    ...(min !== undefined || max !== undefined
      ? { riskScore: { ...(min !== undefined ? { gte: min } : {}), ...(max !== undefined ? { lte: max } : {}) } }
      : {}),
    ...(filters.analyst ? { assignedAnalystId: filters.analyst === UNASSIGNED ? null : filters.analyst } : {}),
  };
}

/** PII is masked at the data-access boundary: callers never receive raw values (reveal is separate). */
function masked(kycCase: KycCase): KycCase {
  return maskObject(kycCase, KYC_PII_FIELDS);
}

/** Analysts who have cases assigned, for the queue filter (value: user id, label: email). */
export async function listAnalystOptions(user: AuthUser): Promise<FilterOption[]> {
  assertCan(user, "read", { type: "kyc" });
  const rows = await prisma.kycCase.findMany({
    where: { assignedAnalystId: { not: null } },
    distinct: ["assignedAnalystId"],
    select: { assignedAnalystId: true, assignedAnalystEmail: true },
    orderBy: { assignedAnalystEmail: "asc" },
  });
  return rows.flatMap((r) => (r.assignedAnalystId ? [{ value: r.assignedAnalystId, label: r.assignedAnalystEmail ?? r.assignedAnalystId }] : []));
}

export async function listKycCases(user: AuthUser, params: TableParams) {
  assertCan(user, "read", { type: "kyc" });
  const where = buildKycWhere(params.filters);
  const [rows, total] = await Promise.all([
    prisma.kycCase.findMany({
      where,
      orderBy: [{ [params.sort.field]: params.sort.direction }, { id: "asc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.kycCase.count({ where }),
  ]);
  return { rows: rows.map(masked), total };
}

export async function getKycCase(user: AuthUser, id: string): Promise<KycCase> {
  assertCan(user, "read", { type: "kyc", id });
  const kycCase = await prisma.kycCase.findUnique({ where: { id } });
  if (!kycCase) throw new NotFoundError("Case not found.");
  return masked(kycCase);
}

/** High-risk approval requests for a case, newest first. */
export async function listKycApprovalRequests(user: AuthUser, kycCaseId: string) {
  assertCan(user, "read", { type: "kyc", id: kycCaseId });
  return prisma.approvalRequest.findMany({
    where: { ruleKey: kycHighRiskApprovalRule.key, entityType: KYC_CASE_ENTITY, entityId: kycCaseId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}
