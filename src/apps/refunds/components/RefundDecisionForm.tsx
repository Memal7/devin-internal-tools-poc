"use client";

import { useActionState } from "react";
import type { FormState } from "@/platform/ui/form-state";
import { decideRefundAction } from "../actions";

export function RefundDecisionForm({ refundId }: { refundId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(decideRefundAction, null);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="refundId" value={refundId} />
      {state?.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" data-testid="decision-error">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {state.message}
        </p>
      )}
      <label className="block text-sm font-medium text-slate-700">
        Reason <span className="font-normal text-slate-500">(required to decline)</span>
        <textarea name="reason" rows={2} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </label>
      {state?.fieldErrors?.reason?.map((e) => (
        <p key={e} className="text-xs text-red-600">
          {e}
        </p>
      ))}
      <div className="flex gap-2">
        <button
          type="submit"
          name="decision"
          value="approve"
          disabled={pending}
          className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-600 disabled:opacity-50"
        >
          Approve refund
        </button>
        <button
          type="submit"
          name="decision"
          value="decline"
          disabled={pending}
          className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
        >
          Decline refund
        </button>
      </div>
    </form>
  );
}
