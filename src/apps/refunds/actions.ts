"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { parseAmountToMinor } from "@/platform/money";
import { formDataToObject, secureAction } from "@/platform/rbac/enforce";
import type { FormState } from "@/platform/ui/form-state";
import { decideRefund, decideRefundSchema, requestRefund } from "./service";

const requestRefundFormSchema = z
  .object({
    paymentId: z.string().trim().min(1, "Required").max(100),
    amount: z.string().trim().min(1, "Required"),
    reason: z.string().trim().min(3, "At least 3 characters").max(500),
  })
  .transform((input, ctx) => {
    // Payments in this app use 2 minor digits; requestRefund() validates the integer amount.
    const amountMinor = parseAmountToMinor(input.amount, "EUR");
    if (amountMinor === null || amountMinor <= 0) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter an amount like 120.50" });
      return z.NEVER;
    }
    return { paymentId: input.paymentId, amountMinor, reason: input.reason };
  });

const submitRefund = secureAction({
  schema: requestRefundFormSchema,
  action: "create",
  resource: () => ({ type: "refund" }),
  handler: ({ user, input }) => requestRefund(user, input),
});

export async function requestRefundAction(_state: FormState, formData: FormData): Promise<FormState> {
  const result = await submitRefund(formDataToObject(formData));
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  revalidatePath("/refunds");
  revalidatePath("/refunds/payments");
  redirect(`/refunds/${result.data.refund.id}`);
}

const decide = secureAction({
  schema: decideRefundSchema,
  action: "decide",
  resource: (input) => ({ type: "refund", id: input.refundId }),
  // The four-eyes check runs in decideRefund against the stored refund (and audits blocked attempts).
  check: "role",
  handler: ({ user, input }) => decideRefund(user, input),
});

export async function decideRefundAction(_state: FormState, formData: FormData): Promise<FormState> {
  const result = await decide(formDataToObject(formData));
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  revalidatePath(`/refunds/${result.data.id}`);
  revalidatePath("/refunds");
  revalidatePath("/approvals");
  return { ok: true, message: `Refund ${result.data.status}.` };
}
