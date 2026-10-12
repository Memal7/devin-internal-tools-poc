import type { Prisma } from "@prisma/client";
import { prisma } from "@/platform/db";
import type { TableParams } from "@/platform/ui/table-params";

export const AUDIT_SORTABLE = ["createdAt", "actorEmail", "action", "entityType"] as const;

export const AUDIT_FILTERS = [
  { name: "actor", label: "Actor email", type: "text" },
  { name: "action", label: "Action", type: "text" },
  { name: "entityType", label: "Entity type", type: "text" },
  { name: "entityId", label: "Entity id", type: "text" },
  { name: "from", label: "From (UTC)", type: "date" },
  { name: "to", label: "To (UTC)", type: "date" },
] as const;

function utcDay(value: string | undefined, endOfDay: boolean): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Read-only query for the audit log viewer. Callers must check `audit:read` first. */
export async function listAuditEvents(params: TableParams) {
  const f = params.filters;
  const from = utcDay(f.from, false);
  const to = utcDay(f.to, true);
  const where: Prisma.AuditEventWhereInput = {
    ...(f.actor ? { actorEmail: { contains: f.actor } } : {}),
    ...(f.action ? { action: { contains: f.action } } : {}),
    ...(f.entityType ? { entityType: f.entityType } : {}),
    ...(f.entityId ? { entityId: f.entityId } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: [{ [params.sort.field]: params.sort.direction }, { id: "asc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.auditEvent.count({ where }),
  ]);
  return { rows, total };
}

export async function listEntityHistory(entityType: string, entityId: string) {
  return prisma.auditEvent.findMany({
    where: { entityType, entityId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}
