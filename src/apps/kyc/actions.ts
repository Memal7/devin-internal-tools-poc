"use server";

import { revalidatePath } from "next/cache";
import { formDataToObject, secureAction } from "@/platform/rbac/enforce";
import type { FormState } from "@/platform/ui/form-state";
import {
  claimKycCase,
  claimKycCaseSchema,
  confirmKycApproval,
  confirmKycApprovalSchema,
  decideKycCase,
  decideKycCaseSchema,
} from "./service";
import { statusLabel } from "./status";

function revalidate(caseId: string) {
  revalidatePath(`/kyc/${caseId}`);
  revalidatePath("/kyc");
  revalidatePath("/approvals");
}

const claim = secureAction({
  schema: claimKycCaseSchema,
  action: "claim",
  resource: (input) => ({ type: "kyc", id: input.caseId }),
  handler: ({ user, input }) => claimKycCase(user, input),
});

/** Bound to the case id on the detail page: `claimKycCaseAction.bind(null, id)`. */
export async function claimKycCaseAction(caseId: string): Promise<FormState> {
  const result = await claim({ caseId });
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  revalidate(result.data.id);
  return { ok: true, message: "Case claimed: it is in review and assigned to you." };
}

const decide = secureAction({
  schema: decideKycCaseSchema,
  action: "decide",
  resource: (input) => ({ type: "kyc", id: input.caseId }),
  // "Only the assigned analyst" is checked in decideKycCase against the stored case.
  check: "role",
  handler: ({ user, input }) => decideKycCase(user, input),
});

export async function decideKycCaseAction(caseId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const result = await decide({ ...formDataToObject(formData), caseId });
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  revalidate(caseId);
  if (result.data.approvalRequest) {
    return { ok: true, message: "High-risk case: approval requested. A different approver must confirm it (four-eyes)." };
  }
  return { ok: true, message: `Case ${statusLabel(result.data.kycCase.status).toLowerCase()}.` };
}

const confirm = secureAction({
  schema: confirmKycApprovalSchema,
  action: "confirm",
  resource: (input) => ({ type: "kyc", id: input.caseId }),
  // The four-eyes check runs in confirmKycApproval against the stored request (and audits blocked attempts).
  check: "role",
  handler: ({ user, input }) => confirmKycApproval(user, input),
});

export async function confirmKycApprovalAction(caseId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const result = await confirm({ ...formDataToObject(formData), caseId });
  if (!result.ok) return { error: result.error, fieldErrors: result.fieldErrors };
  revalidate(caseId);
  return {
    ok: true,
    message: result.data.status === "approved" ? "Approval confirmed: case approved." : "Approval declined: the case is back in review.",
  };
}
