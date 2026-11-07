/**
 * Money is always handled as an integer number of minor units (paise, cents)
 * together with an ISO-4217 currency code. Floating point is never used for
 * stored amounts. Rates (tax, service charge, percentage discounts) are basis
 * points: 1 bps = 0.01 %, so 500 bps = 5 %.
 */

export const SUPPORTED_CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD"] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

/** Minor units per major unit. All supported currencies use 2 decimals. */
export const MINOR_UNITS: Record<CurrencyCode, number> = {
  INR: 100,
  USD: 100,
  EUR: 100,
  GBP: 100,
  AED: 100,
  SGD: 100,
};

export const MAX_BPS = 10_000;

export function isCurrencyCode(value: string): value is CurrencyCode {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value);
}

export function assertMinorUnits(amount: number, label = "amount"): void {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError(`${label} must be an integer number of minor units`);
  }
}

/**
 * Apply a rate in basis points, rounding half away from zero (commercial
 * rounding). `applyBps(1999, 500)` → 100 (5 % of ₹19.99 = ₹0.9995 → ₹1.00).
 */
export function applyBps(amount: number, bps: number): number {
  assertMinorUnits(amount);
  if (!Number.isInteger(bps) || bps < 0) throw new RangeError("bps must be a non-negative integer");
  const raw = (amount * bps) / MAX_BPS;
  return Math.sign(raw) * Math.round(Math.abs(raw));
}

/** Convert a major-unit decimal string/number (e.g. "199.50") to minor units. */
export function toMinor(major: number | string, currency: CurrencyCode = "INR"): number {
  const value = typeof major === "string" ? Number(major) : major;
  if (!Number.isFinite(value)) throw new RangeError("Invalid amount");
  return Math.round(value * MINOR_UNITS[currency]);
}

export function toMajor(minor: number, currency: CurrencyCode = "INR"): number {
  return minor / MINOR_UNITS[currency];
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Locale-aware currency formatting for display only. */
export function formatMoney(minor: number, currency: string, locale = "en-IN"): string {
  const code = isCurrencyCode(currency) ? currency : "INR";
  const cacheKey = `${locale}:${code}`;
  let formatter = formatters.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    formatters.set(cacheKey, formatter);
  }
  return formatter.format(toMajor(minor, code));
}

export function sum(values: readonly number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}
