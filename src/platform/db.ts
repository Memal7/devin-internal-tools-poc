import { PrismaClient } from "@prisma/client";

const APPEND_ONLY_MESSAGE = "audit_events is append-only: update and delete are not allowed";

function rejectAuditMutation(): never {
  throw new Error(APPEND_ONLY_MESSAGE);
}

function createClient() {
  return new PrismaClient().$extends({
    name: "audit-events-append-only",
    query: {
      auditEvent: {
        update: rejectAuditMutation,
        updateMany: rejectAuditMutation,
        upsert: rejectAuditMutation,
        delete: rejectAuditMutation,
        deleteMany: rejectAuditMutation,
      },
    },
  });
}

export type Db = ReturnType<typeof createClient>;
export type DbTransaction = Omit<Db, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

const globalForPrisma = globalThis as unknown as { prisma?: Db };

export const prisma: Db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
