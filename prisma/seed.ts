import { SEED_KYC_CASE_COUNT, seedKycDemo } from "../src/apps/kyc/seed";
import { syncDecidedKycCases } from "../src/apps/kyc/service";
import { SEED_PAYMENT_COUNT, seedRefundsDemo } from "../src/apps/refunds/seed";
import { syncDecidedRefunds } from "../src/apps/refunds/service";
import { decideApproval, requestApproval } from "../src/platform/approvals/service";
import { demoPaymentRule } from "../src/platform/approvals/rules";
import { SYSTEM_ACTOR } from "../src/platform/audit/types";
import { DEMO_USERS } from "../src/platform/auth/demo-users";
import { findAuthUserByEmail, provisionUser } from "../src/platform/auth/users";
import { prisma } from "../src/platform/db";
import type { AuthUser } from "../src/platform/rbac/types";

// Idempotent: only creates what is missing. All writes go through withAudit().
async function ensureUsers(): Promise<Record<string, AuthUser>> {
  const users: Record<string, AuthUser> = {};
  for (const demo of DEMO_USERS) {
    users[demo.email] =
      (await findAuthUserByEmail(demo.email)) ?? (await provisionUser(SYSTEM_ACTOR, { email: demo.email, name: demo.name, roles: demo.roles }));
  }
  return users;
}

function demoRequest(summary: string, amountMinor: number, currency: string, beneficiaryName: string, beneficiaryIban: string, n: number) {
  return {
    ruleKey: demoPaymentRule.key,
    entityType: demoPaymentRule.entityType,
    entityId: `demo-seed-${n}`,
    summary,
    amountMinor,
    currency,
    payload: { beneficiaryName, beneficiaryIban },
  };
}

async function ensureApprovals(users: Record<string, AuthUser>) {
  if ((await prisma.approvalRequest.count()) > 0) return;
  const operator = users["operator@demo.local"]!;
  const lead = users["lead@demo.local"]!;
  const approver = users["approver@demo.local"]!;

  await requestApproval(operator, demoRequest("Supplier payment: office lease Q4", 250_000, "EUR", "Jane Example", "DE89370400440532013000", 1));
  await requestApproval(operator, demoRequest("Card processor settlement correction", 1_200_000, "USD", "John Sample", "GB29NWBK60161331926819", 2));
  await requestApproval(lead, demoRequest("Customer goodwill payment (requested by lead)", 500_000, "EUR", "Maria Muster", "FR1420041010050500013M02606", 3));

  const approved = await requestApproval(operator, demoRequest("Payroll top-up", 180_000, "GBP", "Alex Placeholder", "GB82WEST12345698765432", 4));
  if (approved.required) await decideApproval(approver, { requestId: approved.request.id, decision: "approve", reason: "Matches invoice" });

  const declined = await requestApproval(lead, demoRequest("Duplicate vendor invoice", 320_000, "EUR", "Sam Testcase", "NL91ABNA0417164300", 5));
  if (declined.required) await decideApproval(approver, { requestId: declined.request.id, decision: "decline", reason: "Duplicate of an already paid invoice" });
}

async function main() {
  const users = await ensureUsers();
  await ensureApprovals(users);
  await seedRefundsDemo(users);
  await syncDecidedRefunds();
  await seedKycDemo(users);
  await syncDecidedKycCases();
  console.log(`Seeded ${DEMO_USERS.length} demo users, demo approval requests, ${SEED_PAYMENT_COUNT} payments with demo refunds and ${SEED_KYC_CASE_COUNT} KYC cases.`);
}

main()
  .catch((error: unknown) => {
    console.error("Seed failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
