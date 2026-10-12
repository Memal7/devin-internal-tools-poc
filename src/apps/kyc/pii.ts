import { prisma } from "@/platform/db";
import type { PiiFieldMap, PiiResolver } from "@/platform/pii/types";
import { KYC_CASE_ENTITY } from "./rules";

export const KYC_PII_FIELDS = {
  customerName: "name",
  dateOfBirth: "dateOfBirth",
  documentNumber: "documentNumber",
} as const satisfies PiiFieldMap;

type KycPiiField = keyof typeof KYC_PII_FIELDS;

function isKycPiiField(field: string): field is KycPiiField {
  return Object.hasOwn(KYC_PII_FIELDS, field);
}

/** Lets `revealPII()` read a case's PII fields (requires pii:reveal and kyc:read). */
export const kycCasePiiResolver: PiiResolver = {
  entityType: KYC_CASE_ENTITY,
  fields: KYC_PII_FIELDS,
  readCheck: { action: "read", resourceType: "kyc" },
  resolve: async (entityId, field) => {
    if (!isKycPiiField(field)) return null;
    const kycCase = await prisma.kycCase.findUnique({
      where: { id: entityId },
      select: { customerName: true, dateOfBirth: true, documentNumber: true },
    });
    return kycCase?.[field] ?? null;
  },
};
