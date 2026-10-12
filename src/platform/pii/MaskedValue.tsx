"use client";

import { useState, useTransition } from "react";
import { revealPiiAction } from "./actions";

interface MaskedValueProps {
  masked: string;
  entityType: string;
  entityId: string;
  field: string;
  /** UI hint only. The server action checks pii:reveal and audits the reveal. */
  canReveal: boolean;
}

export function MaskedValue({ masked, entityType, entityId, field, canReveal }: MaskedValueProps) {
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onReveal = () =>
    startTransition(async () => {
      const result = await revealPiiAction({ entityType, entityId, field });
      if (result.ok) {
        setValue(result.data);
        setError(null);
      } else {
        setError(result.error);
      }
    });

  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono" data-testid={`pii-${field}`}>
        {value ?? masked}
      </span>
      {canReveal && value === null && (
        <button
          type="button"
          onClick={onReveal}
          disabled={pending}
          className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {pending ? "…" : "Reveal"}
        </button>
      )}
      {value !== null && <span className="text-xs text-amber-700">revealed (audited)</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
