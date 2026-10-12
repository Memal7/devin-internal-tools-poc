"use client";

import { useActionState } from "react";
import type { FormState } from "./form-state";

export interface FieldDef {
  name: string;
  label: string;
  type: "text" | "email" | "number" | "date" | "textarea" | "select";
  required?: boolean;
  placeholder?: string;
  help?: string;
  defaultValue?: string;
  options?: readonly { value: string; label: string }[];
  /** For money fields use type "text" with inputMode "decimal"; the server converts to minor units. */
  inputMode?: "text" | "decimal" | "numeric";
}

interface EntityFormProps {
  fields: readonly FieldDef[];
  /** A server action. It must validate with Zod and call can() on the server. */
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
}

const inputClass = "mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none";

/** Generic create/edit form. Rendering only: validation and authorization happen on the server. */
export function EntityForm({ fields, action, submitLabel }: EntityFormProps) {
  const [state, formAction, pending] = useActionState(action, null);

  return (
    <form action={formAction} className="space-y-4 rounded-lg border border-slate-200 bg-white p-6" noValidate>
      {state?.error && (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}
      {state?.ok && state.message && (
        <p role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {state.message}
        </p>
      )}
      {fields.map((field) => {
        const errors = state?.fieldErrors?.[field.name];
        const id = `field-${field.name}`;
        return (
          <div key={field.name}>
            <label htmlFor={id} className="block text-sm font-medium text-slate-700">
              {field.label}
              {field.required && <span className="text-red-600"> *</span>}
            </label>
            {field.type === "textarea" ? (
              <textarea id={id} name={field.name} defaultValue={field.defaultValue} placeholder={field.placeholder} rows={3} className={inputClass} />
            ) : field.type === "select" ? (
              <select id={id} name={field.name} defaultValue={field.defaultValue} className={inputClass}>
                {field.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                name={field.name}
                type={field.type}
                inputMode={field.inputMode}
                defaultValue={field.defaultValue}
                placeholder={field.placeholder}
                className={inputClass}
              />
            )}
            {field.help && <p className="mt-1 text-xs text-slate-500">{field.help}</p>}
            {errors?.map((error) => (
              <p key={error} className="mt-1 text-xs text-red-600">
                {error}
              </p>
            ))}
          </div>
        );
      })}
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {pending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
