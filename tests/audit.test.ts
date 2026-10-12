import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SYSTEM_ACTOR, actorFromUser } from "@/platform/audit/types";
import { recordAuditEvent, withAudit } from "@/platform/audit/with-audit";
import { provisionUser } from "@/platform/auth/users";
import { prisma } from "@/platform/db";
import { createUser } from "./helpers";

describe("withAudit()", () => {
  it("records actor, action, entity, before/after JSON and a UTC timestamp", async () => {
    const admin = await createUser("admin");
    const startedAt = Date.now();
    const entityId = await withAudit(
      { actor: actorFromUser(admin), action: "thing.update", entityType: "Thing" },
      async () => ({ entityId: "thing-1", before: { status: "a" }, after: { status: "b" }, result: "thing-1" }),
    );
    expect(entityId).toBe("thing-1");
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { entityType: "Thing", entityId: "thing-1" } });
    expect(event).toMatchObject({ actorId: admin.id, actorEmail: admin.email, action: "thing.update" });
    expect(JSON.parse(event.before!)).toEqual({ status: "a" });
    expect(JSON.parse(event.after!)).toEqual({ status: "b" });
    expect(event.createdAt.getTime()).toBeGreaterThanOrEqual(startedAt - 1000);
    expect(event.createdAt.toISOString().endsWith("Z")).toBe(true);
  });

  it("rolls back the data change and writes no event when the mutation fails", async () => {
    const before = await prisma.auditEvent.count();
    const email = `rollback-${Date.now()}@test.local`;
    await expect(
      withAudit({ actor: SYSTEM_ACTOR, action: "user.create", entityType: "User" }, async (tx) => {
        await tx.user.create({ data: { email, name: "Rollback" } });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    expect(await prisma.auditEvent.count()).toBe(before);
  });

  it("stores PII fields masked in snapshots", async () => {
    const user = await provisionUser(SYSTEM_ACTOR, { email: `pii-${Date.now()}@test.local`, name: "Jane Doe", roles: ["viewer"] });
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { entityType: "User", entityId: user.id, action: "user.create" } });
    expect(event.after).not.toContain("Jane Doe");
    expect(event.after).not.toContain(user.email);
    expect(JSON.parse(event.after!)).toMatchObject({ name: "J*** D**", roles: ["viewer"] });
  });

  it("audits user provisioning with the system actor", async () => {
    const user = await createUser("operator");
    const event = await prisma.auditEvent.findFirstOrThrow({ where: { entityType: "User", entityId: user.id } });
    expect(event).toMatchObject({ actorId: null, actorEmail: "system", action: "user.create" });
  });
});

describe("audit_events is append-only", () => {
  async function seedEvent() {
    await recordAuditEvent({ actor: SYSTEM_ACTOR, action: "test.event", entityType: "Test", entityId: `t-${Date.now()}` });
    return prisma.auditEvent.findFirstOrThrow({ where: { action: "test.event" }, orderBy: { createdAt: "desc" } });
  }

  // These calls exist only to prove the guards reject them.
  it("rejects update and delete through the Prisma client", async () => {
    const event = await seedEvent();
    await expect(prisma.auditEvent.update({ where: { id: event.id }, data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.updateMany({ data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.deleteMany({})).rejects.toThrow(/append-only/);
    await expect(
      prisma.auditEvent.upsert({ where: { id: event.id }, create: { ...event }, update: { action: "tampered" } }),
    ).rejects.toThrow(/append-only/);
  });

  it("rejects raw UPDATE and DELETE at the database level", async () => {
    const event = await seedEvent();
    await expect(prisma.$executeRawUnsafe(`UPDATE audit_events SET action = 'tampered' WHERE id = ?`, event.id)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM audit_events WHERE id = ?`, event.id)).rejects.toThrow(/append-only/);
    expect((await prisma.auditEvent.findUniqueOrThrow({ where: { id: event.id } })).action).toBe("test.event");
  });

  it("has no update/delete code path for audit events anywhere in the codebase", () => {
    const root = path.resolve(__dirname, "..");
    const self = path.resolve(__filename);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (["node_modules", ".next", ".git", "migrations"].includes(name)) continue;
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx|mjs|js)$/.test(name) && full !== self) files.push(full);
      }
    };
    for (const dir of ["src", "prisma", "scripts", "tests"]) walk(path.join(root, dir));
    const forbidden = [/auditEvent\s*\.\s*(update|updateMany|upsert|delete|deleteMany)\s*\(/, /\b(UPDATE\s+"?audit_events|DELETE\s+FROM\s+"?audit_events)/i];
    const offenders = files.filter((file) => forbidden.some((re) => re.test(readFileSync(file, "utf8"))));
    expect(offenders).toEqual([]);
  });
});
