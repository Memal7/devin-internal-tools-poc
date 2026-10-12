import type { KycCase } from "@prisma/client";
import { SYSTEM_ACTOR } from "@/platform/audit/types";
import { prisma } from "@/platform/db";
import type { AuthUser } from "@/platform/rbac/types";
import { isHighRisk } from "./rules";
import { claimKycCase, confirmKycApproval, createKycCase, decideKycCase } from "./service";
import { DOCUMENT_TYPES, type DocumentType } from "./status";

export const SEED_KYC_CASE_COUNT = 200;

const FIRST_NAMES = [
  "Anna", "Lukas", "Sofia", "Jonas", "Emma", "Noah", "Mia", "Elias", "Lena", "Felix", "Clara", "Paul", "Hannah", "Leon",
  "Marie", "Julian", "Chiara", "Matteo", "Camille", "Hugo", "Inès", "Lucía", "Pablo", "Zofia", "Piotr", "Freya", "Oliver",
  "Aoife", "Sean", "Nora", "Erik", "Yusuf", "Amara", "Kenji", "Priya", "Mateus", "Elif", "Dimitris", "Ana", "Tomasz",
];

const LAST_NAMES = [
  "Müller", "Schmidt", "Fischer", "Weber", "Wagner", "Becker", "Rossi", "Bianchi", "Martin", "Dubois", "García",
  "Fernández", "de Vries", "Jansen", "Kowalski", "Nowak", "Andersson", "Nielsen", "O'Brien", "Murphy", "Smith",
  "Novák", "Horvat", "Papadopoulos", "Silva", "Santos", "Yılmaz", "Okafor", "Tanaka", "Sharma",
];

/** Mostly EU customers, some higher-risk jurisdictions. */
const COUNTRIES = ["DE", "DE", "DE", "AT", "CH", "FR", "IT", "ES", "NL", "PL", "SE", "DK", "IE", "GB", "CZ", "HR", "GR", "PT", "TR", "NG", "JP", "IN", "BR", "AE"];

const APPROVE_REASONS = ["Documents verified against the issuing registry", "Liveness check passed, data consistent", "Address and identity confirmed"];
const REJECT_REASONS = ["Document expired", "Photo does not match the selfie", "Document appears altered", "Name mismatch between document and application"];
const ESCALATE_REASONS = ["Possible sanctions list match", "PEP screening hit needs compliance review", "Inconsistent data across documents"];

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

function documentNumber(random: () => number, type: DocumentType, country: string): string {
  const digits = (n: number) => Array.from({ length: n }, () => int(random, 0, 9)).join("");
  const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + int(random, 0, 25))).join("");
  if (type === "passport") return `${letters(2)}${digits(7)}`;
  if (type === "national_id") return `${country}${digits(8)}`;
  return `${letters(5)}${digits(6)}`;
}

/** ~20% high risk (70-100), the rest 0-69. */
function riskScore(random: () => number): number {
  return random() < 0.2 ? int(random, 70, 100) : int(random, 0, 69);
}

async function seedCases(): Promise<void> {
  const random = prng(20261012);
  const now = Date.now();
  for (let i = 1; i <= SEED_KYC_CASE_COUNT; i += 1) {
    const country = pick(random, COUNTRIES);
    const documentType = pick(random, DOCUMENT_TYPES);
    const birth = new Date(Date.UTC(int(random, 1945, 2006), int(random, 0, 11), int(random, 1, 28)));
    await createKycCase(SYSTEM_ACTOR, {
      reference: `KYC-${String(i).padStart(6, "0")}`,
      customerName: `${pick(random, FIRST_NAMES)} ${pick(random, LAST_NAMES)}`,
      dateOfBirth: birth.toISOString().slice(0, 10),
      documentType,
      documentNumber: documentNumber(random, documentType, country),
      country,
      riskScore: riskScore(random),
      createdAt: new Date(now - (SEED_KYC_CASE_COUNT - i) * 4 * 60 * 60 * 1000 - int(random, 0, 3_600_000)),
    });
  }
}

/**
 * 200 cases, then the real (audited) workflow on a subset so every status and every
 * four-eyes state is represented. Idempotent: does nothing if cases already exist.
 */
export async function seedKycDemo(users: Record<string, AuthUser>): Promise<void> {
  if ((await prisma.kycCase.count()) > 0) return;
  await seedCases();

  const operator = users["operator@demo.local"]!;
  const lead = users["lead@demo.local"]!;
  const approver = users["approver@demo.local"]!;
  const cases = await prisma.kycCase.findMany({ orderBy: { reference: "asc" } });
  const low = cases.filter((c) => !isHighRisk(c.riskScore));
  const high = cases.filter((c) => isHighRisk(c.riskScore));
  const next = (pool: KycCase[]) => {
    const kycCase = pool.shift();
    if (!kycCase) throw new Error("Not enough seed cases for the demo workflow.");
    return kycCase;
  };
  const claimed = async (analyst: AuthUser, kycCase: KycCase) => {
    await claimKycCase(analyst, { caseId: kycCase.id });
    return kycCase;
  };
  const analystFor = (i: number) => (i % 4 === 3 ? lead : operator);

  for (let i = 0; i < 20; i += 1) {
    const c = await claimed(analystFor(i), next(low));
    await decideKycCase(analystFor(i), { caseId: c.id, decision: "approve", reason: APPROVE_REASONS[i % APPROVE_REASONS.length]! });
  }
  for (let i = 0; i < 10; i += 1) {
    const c = await claimed(analystFor(i), next(i % 3 === 0 ? high : low));
    await decideKycCase(analystFor(i), { caseId: c.id, decision: "reject", reason: REJECT_REASONS[i % REJECT_REASONS.length]! });
  }
  for (let i = 0; i < 8; i += 1) {
    const c = await claimed(analystFor(i), next(i % 2 === 0 ? high : low));
    await decideKycCase(analystFor(i), { caseId: c.id, decision: "escalate", reason: ESCALATE_REASONS[i % ESCALATE_REASONS.length]! });
  }
  // High-risk approvals confirmed by a second person.
  for (let i = 0; i < 6; i += 1) {
    const c = await claimed(analystFor(i), next(high));
    await decideKycCase(analystFor(i), { caseId: c.id, decision: "approve", reason: APPROVE_REASONS[i % APPROVE_REASONS.length]! });
    await confirmKycApproval(approver, { caseId: c.id, decision: "confirm", reason: "Second check done" });
  }
  // Declined by the approver: back in review with the analyst.
  {
    const c = await claimed(operator, next(high));
    await decideKycCase(operator, { caseId: c.id, decision: "approve", reason: APPROVE_REASONS[0]! });
    await confirmKycApproval(approver, { caseId: c.id, decision: "decline", reason: "Source of funds not documented" });
  }
  // Waiting for a second approver: 3 requested by operator, 2 by lead (lead cannot confirm their own).
  for (let i = 0; i < 5; i += 1) {
    const analyst = i < 3 ? operator : lead;
    const c = await claimed(analyst, next(high));
    await decideKycCase(analyst, { caseId: c.id, decision: "approve", reason: APPROVE_REASONS[i % APPROVE_REASONS.length]! });
  }
  // Claimed, not yet decided.
  for (let i = 0; i < 18; i += 1) {
    await claimed(i < 12 ? operator : lead, next(i % 6 === 0 ? high : low));
  }
}
