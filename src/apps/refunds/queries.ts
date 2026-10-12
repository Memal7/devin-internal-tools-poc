import type { Prisma } from "@prisma/client";
import { prisma } from "@/platform/db";
import { NotFoundError } from "@/platform/errors";
import { parseAmountToMinor } from "@/platform/money";
import { assertCan } from "@/platform/rbac/assert";
import type { AuthUser } from "@/platform/rbac/types";
import type { TableParams } from "@/platform/ui/table-params";
import { REFUND_STATUSES } from "./status";

export const REFUND_SORTABLE = ["createdAt", "amountMinor", "status"] as const;

export const REFUND_FILTERS = [
  { name: "status", label: "Status", type: "select", options: REFUND_STATUSES.map((s) => ({ value: s, label: s })) },
  { name: "min", label: "Min amount", type: "text" },
  { name: "max", label: "Max amount", type: "text" },
  { name: "from", label: "Requested from (UTC)", type: "date" },
  { name: "to", label: "Requested to (UTC)", type: "date" },
] as const;

function utcDay(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Amount filters are entered as decimals (e.g. 500.00) and compared in minor units. */
function amountFilter(value: string | undefined): number | undefined {
  if (!value) return undefined;
  return parseAmountToMinor(value, "EUR") ?? undefined;
}

export function buildRefundWhere(filters: TableParams["filters"]): Prisma.RefundWhereInput {
  const min = amountFilter(filters.min);
  const max = amountFilter(filters.max);
  const from = utcDay(filters.from, false);
  const to = utcDay(filters.to, true);
  return {
    ...(filters.status ? { status: filters.status } : {}),
    ...(min !== undefined || max !== undefined
      ? { amountMinor: { ...(min !== undefined ? { gte: min } : {}), ...(max !== undefined ? { lte: max } : {}) } }
      : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
}

export async function listRefunds(user: AuthUser, params: TableParams) {
  assertCan(user, "read", { type: "refund" });
  const where = buildRefundWhere(params.filters);
  const [rows, total] = await Promise.all([
    prisma.refund.findMany({
      where,
      include: { payment: { select: { id: true, reference: true, customerName: true } } },
      orderBy: [{ [params.sort.field]: params.sort.direction }, { id: "asc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.refund.count({ where }),
  ]);
  return { rows, total };
}

export type RefundListRow = Awaited<ReturnType<typeof listRefunds>>["rows"][number];

export async function getRefund(user: AuthUser, id: string) {
  assertCan(user, "read", { type: "refund", id });
  const refund = await prisma.refund.findUnique({ where: { id }, include: { payment: true } });
  if (!refund) throw new NotFoundError("Refund not found.");
  return refund;
}
