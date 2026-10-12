import { SYSTEM_ACTOR } from "@/platform/audit/types";
import { decideApproval } from "@/platform/approvals/service";
import { prisma } from "@/platform/db";
import type { AuthUser } from "@/platform/rbac/types";
import { createPayment } from "./payments";
import { requestRefund } from "./service";
import type { PaymentStatus } from "./status";

export const SEED_PAYMENT_COUNT = 300;

const FIRST_NAMES = [
  "Anna", "Lukas", "Sofia", "Jonas", "Emma", "Noah", "Mia", "Elias", "Lena", "Felix", "Clara", "Paul", "Hannah", "Leon",
  "Marie", "Julian", "Laura", "David", "Sara", "Tim", "Chiara", "Matteo", "Camille", "Hugo", "Inès", "Lucas", "Lucía",
  "Pablo", "Eva", "Jan", "Zofia", "Piotr", "Freya", "Oliver", "Amelia", "Liam", "Aoife", "Sean", "Nora", "Erik",
];

const LAST_NAMES = [
  "Müller", "Schmidt", "Schneider", "Fischer", "Weber", "Meyer", "Wagner", "Becker", "Hoffmann", "Schulz", "Rossi",
  "Russo", "Bianchi", "Martin", "Bernard", "Dubois", "García", "Fernández", "López", "Martínez", "de Vries", "Jansen",
  "Bakker", "Kowalski", "Nowak", "Wiśniewski", "Andersson", "Johansson", "Nielsen", "Hansen", "O'Brien", "Murphy",
  "Smith", "Jones", "Taylor", "Novák", "Horvat", "Papadopoulos", "Silva", "Santos",
];

const REASONS = [
  "Customer returned the goods",
  "Duplicate charge",
  "Order cancelled before shipping",
  "Item arrived damaged",
  "Service not delivered",
  "Goodwill gesture after complaint",
  "Partial refund: missing item",
];

/** Deterministic PRNG (mulberry32) so every seeded database looks the same. */
function prng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

function int(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** Mostly small card payments, some larger orders: 5.00 to 4,800.00 EUR. */
function amountMinor(random: () => number): number {
  const bucket = random();
  const euros = bucket < 0.55 ? int(random, 5, 150) : bucket < 0.8 ? int(random, 150, 500) : bucket < 0.95 ? int(random, 500, 2000) : int(random, 2000, 4800);
  return euros * 100 + pick(random, [0, 0, 49, 90, 95, 99]);
}

function status(random: () => number): PaymentStatus {
  const value = random();
  return value < 0.9 ? "succeeded" : value < 0.96 ? "failed" : "pending";
}

async function seedPayments() {
  const random = prng(20261012);
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  for (let n = 1; n <= SEED_PAYMENT_COUNT; n += 1) {
    await createPayment(SYSTEM_ACTOR, {
      reference: `PAY-${String(n).padStart(6, "0")}`,
      customerName: `${pick(random, FIRST_NAMES)} ${pick(random, LAST_NAMES)}`,
      amountMinor: amountMinor(random),
      currency: "EUR",
      status: status(random),
      createdAt: new Date(now - int(random, 0, 120 * dayMs)),
    });
  }
}

/**
 * Demo refunds created through the real services (rules, approvals and audit apply).
 * Idempotent: does nothing once any refund exists.
 */
async function seedRefunds(users: Record<string, AuthUser>) {
  if ((await prisma.refund.count()) > 0) return;
  const operator = users["operator@demo.local"]!;
  const lead = users["lead@demo.local"]!;
  const approver = users["approver@demo.local"]!;
  const succeeded = await prisma.payment.findMany({ where: { status: "succeeded" }, orderBy: { reference: "asc" } });
  const small = succeeded.filter((p) => p.amountMinor >= 2_000 && p.amountMinor <= 40_000);
  const large = succeeded.filter((p) => p.amountMinor >= 80_000);

  // Auto-approved (<= 500.00 EUR): partial refunds plus a couple of full ones.
  for (const [i, payment] of small.slice(0, 18).entries()) {
    const full = i % 6 === 0;
    await requestRefund(i % 4 === 3 ? lead : operator, {
      paymentId: payment.id,
      amountMinor: full ? payment.amountMinor : Math.floor(payment.amountMinor / 2),
      reason: REASONS[i % REASONS.length]!,
    });
  }

  // Above 500.00 EUR: need a second approver.
  const [a, b, c, d, e, f, g, h] = large;
  const pending = [a, b, c, d].filter((p) => p !== undefined);
  for (const [i, payment] of pending.entries()) {
    await requestRefund(operator, { paymentId: payment.id, amountMinor: 50_001 + i * 12_345, reason: REASONS[(i + 2) % REASONS.length]! });
  }
  if (e) await requestRefund(lead, { paymentId: e.id, amountMinor: 75_000, reason: "Goodwill gesture after complaint (requested by lead)" });

  if (f) {
    const result = await requestRefund(operator, { paymentId: f.id, amountMinor: 60_000, reason: "Order cancelled before shipping" });
    if (result.approvalRequest) {
      await decideApproval(approver, { requestId: result.approvalRequest.id, decision: "approve", reason: "Cancellation confirmed by logistics" });
    }
  }
  if (g) {
    const result = await requestRefund(lead, { paymentId: g.id, amountMinor: g.amountMinor, reason: "Service not delivered" });
    if (result.approvalRequest) {
      await decideApproval(approver, { requestId: result.approvalRequest.id, decision: "approve", reason: "Provider confirmed outage" });
    }
  }
  if (h) {
    const result = await requestRefund(operator, { paymentId: h.id, amountMinor: 70_000, reason: "Duplicate charge" });
    if (result.approvalRequest) {
      await decideApproval(approver, { requestId: result.approvalRequest.id, decision: "decline", reason: "Not a duplicate: two separate orders" });
    }
  }
}

/** Seeds 300 payments and demo refunds. Idempotent. All writes go through withAudit(). */
export async function seedRefundsDemo(users: Record<string, AuthUser>): Promise<void> {
  if ((await prisma.payment.count()) === 0) await seedPayments();
  await seedRefunds(users);
}
