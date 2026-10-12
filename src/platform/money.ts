/** Money is always integer minor units + ISO 4217 code. No floating point anywhere. */
const MINOR_DIGITS: Record<string, number> = { JPY: 0 };

export function minorDigits(currency: string): number {
  return MINOR_DIGITS[currency.toUpperCase()] ?? 2;
}

/** Parses a user-entered decimal string like "1234.50" into integer minor units (string math only). */
export function parseAmountToMinor(value: string, currency: string): number | null {
  const digits = minorDigits(currency);
  const pattern = digits === 0 ? /^\d{1,13}$/ : new RegExp(`^(\\d{1,13})(?:\\.(\\d{1,${digits}}))?$`);
  const match = pattern.exec(value.trim());
  if (!match) return null;
  const whole = match[1] ?? match[0];
  const fraction = (match[2] ?? "").padEnd(digits, "0");
  const minor = Number.parseInt(`${whole}${fraction}`, 10);
  return Number.isSafeInteger(minor) ? minor : null;
}

export function formatMinor(amountMinor: number, currency: string): string {
  const digits = minorDigits(currency);
  const negative = amountMinor < 0;
  const raw = String(Math.abs(amountMinor)).padStart(digits + 1, "0");
  const whole = digits === 0 ? raw : raw.slice(0, -digits);
  const fraction = digits === 0 ? "" : `.${raw.slice(-digits)}`;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction} ${currency.toUpperCase()}`;
}
