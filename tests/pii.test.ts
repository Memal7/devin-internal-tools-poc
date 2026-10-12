import { describe, expect, it } from "vitest";
import { demoPaymentRule } from "@/platform/approvals/rules";
import { requestApproval } from "@/platform/approvals/service";
import { prisma } from "@/platform/db";
import { AuthorizationError, NotFoundError } from "@/platform/errors";
import { maskObject, maskPII } from "@/platform/pii/mask";
import { revealPII } from "@/platform/pii/reveal";
import { createUser } from "./helpers";

describe("maskPII()", () => {
  it("masks each PII kind", () => {
    expect(maskPII("Jane Doe", "name")).toBe("J*** D**");
    expect(maskPII("1990-05-17", "dateOfBirth")).toBe("****-**-**");
    expect(maskPII("X1234567", "documentNumber")).toBe("*****567");
    expect(maskPII("DE89 3704 0044 0532 0130 00", "iban")).toBe("DE****************3000");
    expect(maskPII("4242 4242 4242 4242", "card")).toBe("**** **** **** 4242");
    expect(maskPII("jane@example.com", "email")).toBe("j***@example.com");
    expect(maskPII("secret", "text")).toBe("********");
    expect(maskPII(null, "name")).toBe("");
  });

  it("masks nested fields in objects without mutating the input", () => {
    const input = { id: "1", payload: { beneficiaryIban: "DE89370400440532013000", note: "ok" } };
    const masked = maskObject(input, { "payload.beneficiaryIban": "iban" });
    expect(masked.payload.beneficiaryIban).toBe("DE****************3000");
    expect(masked.payload.note).toBe("ok");
    expect(input.payload.beneficiaryIban).toBe("DE89370400440532013000");
  });
});

describe("revealPII()", () => {
  async function requestWithPii() {
    const operator = await createUser("operator");
    const result = await requestApproval(operator, {
      ruleKey: demoPaymentRule.key,
      entityType: demoPaymentRule.entityType,
      entityId: `pii-${Date.now()}`,
      summary: "PII test",
      amountMinor: 500_000,
      currency: "EUR",
      payload: { beneficiaryName: "Jane Doe", beneficiaryIban: "DE89370400440532013000", note: "public" },
    });
    if (!result.required) throw new Error("expected approval");
    return result.request;
  }

  it("is denied without pii:reveal and writes no audit event", async () => {
    const request = await requestWithPii();
    const viewer = await createUser("viewer");
    await expect(
      revealPII(viewer, { entityType: "ApprovalRequest", entityId: request.id, field: "payload.beneficiaryIban" }),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(await prisma.auditEvent.count({ where: { entityId: request.id, action: "pii.reveal" } })).toBe(0);
  });

  it("returns the value for permitted roles and audits the field (never the value)", async () => {
    const request = await requestWithPii();
    for (const role of ["operator", "approver", "admin"] as const) {
      const user = await createUser(role);
      const value = await revealPII(user, { entityType: "ApprovalRequest", entityId: request.id, field: "payload.beneficiaryIban" });
      expect(value).toBe("DE89370400440532013000");
      const event = await prisma.auditEvent.findFirstOrThrow({ where: { entityId: request.id, action: "pii.reveal", actorId: user.id } });
      expect(JSON.parse(event.metadata!)).toEqual({ field: "payload.beneficiaryIban" });
      expect(JSON.stringify(event)).not.toContain("DE89370400440532013000");
    }
  });

  it("only reveals registered PII fields", async () => {
    const request = await requestWithPii();
    const operator = await createUser("operator");
    await expect(revealPII(operator, { entityType: "ApprovalRequest", entityId: request.id, field: "payload.note" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(revealPII(operator, { entityType: "Unknown", entityId: request.id, field: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });
});
