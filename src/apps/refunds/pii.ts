import { prisma } from "@/platform/db";
import type { PiiFieldMap, PiiResolver } from "@/platform/pii/types";
import { PAYMENT_ENTITY } from "./rules";

export const PAYMENT_PII_FIELDS: PiiFieldMap = { customerName: "name" };

/** Lets `revealPII()` read a payment's customer name (requires pii:reveal and payment:read). */
export const paymentPiiResolver: PiiResolver = {
  entityType: PAYMENT_ENTITY,
  fields: PAYMENT_PII_FIELDS,
  readCheck: { action: "read", resourceType: "payment" },
  resolve: async (entityId, field) => {
    if (field !== "customerName") return null;
    const payment = await prisma.payment.findUnique({ where: { id: entityId }, select: { customerName: true } });
    return payment?.customerName ?? null;
  },
};
