import type { Payment, Prisma } from "@prisma/client";
import { z } from "zod";
import type { AuditActor } from "@/platform/audit/types";
import { withAudit } from "@/platform/audit/with-audit";
import { prisma } from "@/platform/db";
import { NotFoundError } from "@/platform/errors";
import { assertCan } from "@/platform/rbac/assert";
import type { AuthUser } from "@/platform/rbac/types";
import type { TableParams } from "@/platform/ui/table-params";
import { PAYMENT_PII_FIELDS } from "./pii";
import { PAYMENT_ENTITY } from "./rules";
import { PAYMENT_STATUSES } from "./status";

export const PAYMENT_SORTABLE = ["createdAt", "amountMinor", "status", "reference"] as const;

export const PAYMENT_FILTERS = [
  { name: "reference", label: "Reference", type: "text" },
  { name: "status", label: "Status", type: "select", options: PAYMENT_STATUSES.map((s) => ({ value: s, label: s })) },
] as const;

export const createPaymentSchema = z.object({
  reference: z.string().trim().regex(/^PAY-\d{6}$/, "Use the format PAY-000123"),
  customerName: z.string().trim().min(2).max(200),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/, "Use a 3-letter ISO currency code"),
  status: z.enum(PAYMENT_STATUSES),
  createdAt: z.date().optional(),
});

/**
 * Creates a payment (audited, customer name masked in the snapshot). Payments come from the
 * payment processor; this is used by the seed script and tests only, so there is no UI for it.
 */
export async function createPayment(actor: AuditActor, rawInput: z.input<typeof createPaymentSchema>): Promise<Payment> {
  const input = createPaymentSchema.parse(rawInput);
  return withAudit({ actor, action: "payment.create", entityType: PAYMENT_ENTITY, piiFields: PAYMENT_PII_FIELDS }, async (tx) => {
    const payment = await tx.payment.create({ data: input });
    return { entityId: payment.id, after: payment, result: payment };
  });
}

export async function getPayment(user: AuthUser, id: string): Promise<Payment> {
  assertCan(user, "read", { type: "payment", id });
  const payment = await prisma.payment.findUnique({ where: { id } });
  if (!payment) throw new NotFoundError("Payment not found.");
  return payment;
}

export async function listPayments(user: AuthUser, params: TableParams) {
  assertCan(user, "read", { type: "payment" });
  const f = params.filters;
  const where: Prisma.PaymentWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.reference ? { reference: { contains: f.reference.toUpperCase() } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: [{ [params.sort.field]: params.sort.direction }, { id: "asc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    prisma.payment.count({ where }),
  ]);
  return { rows, total };
}

export function refundableMinor(payment: Pick<Payment, "amountMinor" | "refundedMinor">): number {
  return Math.max(0, payment.amountMinor - payment.refundedMinor);
}
