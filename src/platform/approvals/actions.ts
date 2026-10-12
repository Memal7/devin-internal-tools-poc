"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formDataToObject, secureAction } from "@/platform/rbac/enforce";
import { parseAmountToMinor } from "@/platform/money";
import type { FormState } from "@/platform/ui/form-state";
import { demoPaymentRule } from "./rules";
import { decideApproval, decisionSchema, requestApproval } from "./service";

const demoRequestSchema = z
  .object({
    summary: z.string().trim().min(3, "At least 3 characters").max(200),
    amount: z.string().trim().min(1, "Required"),
    currency: z.enum(["EUR", "USD", "GBP"]),
    beneficiaryName: z.string().trim().min(2, "Required").max(200),
    beneficiaryIban: z
      .string()
      .trim()
      .transform((value) => value.replace(/\s+/g, "").toUpperCase())
      .pipe(z.string().regex(/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/, "Enter a valid IBAN")),
  })
  .transform((input, ctx) => {
    const amountMinor = parseAmountToMinor(input.amount, input.currency);
    if (amountMinor === null) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter an amount like 1500.00" });
      return z.NEVER;
    }
    return { ...input, amountMinor };
  });

const createDemoRequest = secureAction({
  schema: demoRequestSchema,
  action: "create",
  resource: () => ({ type: "approval" }),
  handler: ({ user, input }) =>
    requestApproval(user, {
      ruleKey: demoPaymentRule.key,
      entityType: demoPaymentRule.entityType,
      entityId: `demo-${randomUUID()}`,
      summary: input.summary,
      amountMinor: input.amountMinor,
      currency: input.currency,
      payload: { beneficiaryName: input.beneficiaryName, beneficiaryIban: input.beneficiaryIban },
    }),
});

export async function createDemoApprovalAction(_state: FormState, formData: FormData): Promise<FormState> {
  const result = await createDemoRequest(formDataToObject(formData));
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  if (!result.data.required) {
    return { ok: true, message: "Below the approval threshold: no second approval needed, nothing was created." };
  }
  revalidatePath("/approvals");
  redirect(`/approvals/${result.data.request.id}`);
}

const decide = secureAction({
  schema: decisionSchema,
  action: "decide",
  resource: (input) => ({ type: "approval", id: input.requestId }),
  // The four-eyes check runs in decideApproval against the stored record (and audits blocked attempts).
  check: "role",
  handler: ({ user, input }) => decideApproval(user, input),
});

export async function decideApprovalAction(_state: FormState, formData: FormData): Promise<FormState> {
  const result = await decide(formDataToObject(formData));
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  revalidatePath(`/approvals/${result.data.id}`);
  revalidatePath("/approvals");
  return { ok: true, message: `Request ${result.data.status}.` };
}
