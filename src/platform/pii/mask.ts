import type { PiiFieldMap, PiiKind } from "./types";

const STAR = "*";

function keepLast(value: string, visible: number): string {
  const compact = value.replace(/\s+/g, "");
  if (compact.length <= visible) return STAR.repeat(compact.length);
  return STAR.repeat(compact.length - visible) + compact.slice(-visible);
}

/** Masks a PII value for display. Never returns enough of the value to identify a person. */
export function maskPII(value: string | null | undefined, kind: PiiKind): string {
  if (value === null || value === undefined || value === "") return "";
  const trimmed = value.trim();
  switch (kind) {
    case "name":
      return trimmed
        .split(/\s+/)
        .map((part) => part.charAt(0) + STAR.repeat(Math.max(part.length - 1, 2)))
        .join(" ");
    case "dateOfBirth":
      return "****-**-**";
    case "documentNumber":
      return keepLast(trimmed, 3);
    case "iban": {
      const compact = trimmed.replace(/\s+/g, "").toUpperCase();
      if (compact.length <= 6) return STAR.repeat(compact.length);
      return compact.slice(0, 2) + STAR.repeat(compact.length - 6) + compact.slice(-4);
    }
    case "card": {
      const digits = trimmed.replace(/\D/g, "");
      return `**** **** **** ${digits.length >= 4 ? digits.slice(-4) : "****"}`;
    }
    case "email": {
      const [local = "", domain = ""] = trimmed.split("@");
      return `${local.charAt(0)}${STAR.repeat(3)}@${domain || STAR.repeat(3)}`;
    }
    case "text":
      return STAR.repeat(8);
  }
}

/** Returns a copy of `record` with the listed PII fields masked (supports one level of `a.b`). */
export function maskObject<T extends Record<string, unknown>>(record: T, fields: PiiFieldMap): T {
  const copy: Record<string, unknown> = { ...record };
  for (const [path, kind] of Object.entries(fields)) {
    const [head, child] = path.split(".", 2) as [string, string | undefined];
    if (child === undefined) {
      if (typeof copy[head] === "string") copy[head] = maskPII(copy[head] as string, kind);
      continue;
    }
    const nested = copy[head];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const inner = { ...(nested as Record<string, unknown>) };
      if (typeof inner[child] === "string") inner[child] = maskPII(inner[child] as string, kind);
      copy[head] = inner;
    }
  }
  return copy as T;
}
