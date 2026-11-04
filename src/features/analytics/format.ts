import { formatMoney, isCurrencyCode, toMajor } from "@/domain/shared/money";

export { formatMoney };

const compactCache = new Map<string, Intl.NumberFormat>();

/** "₹12.4K" — for axes and dense labels. Exact amounts belong in tooltips and tables. */
export function formatMoneyCompact(minor: number, currency: string): string {
  const code = isCurrencyCode(currency) ? currency : "INR";
  let f = compactCache.get(code);
  if (!f) {
    f = new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: code,
      notation: "compact",
      maximumFractionDigits: 1,
    });
    compactCache.set(code, f);
  }
  return f.format(toMajor(minor, code));
}

const intFmt = new Intl.NumberFormat("en-IN");
const compactFmt = new Intl.NumberFormat("en-IN", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function formatCount(n: number): string {
  return intFmt.format(n);
}

export function formatCountCompact(n: number): string {
  return Math.abs(n) < 10_000 ? intFmt.format(n) : compactFmt.format(n);
}

export function formatMinutes(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  if (min < 60) return `${min % 1 === 0 ? min : min.toFixed(1)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function formatPercent(p: number | null | undefined): string {
  return p === null || p === undefined ? "—" : `${p % 1 === 0 ? p : p.toFixed(1)}%`;
}

const dayFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});
const longDayFmt = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "2 Mar" for an ISO calendar date (no time-zone shift). */
export function formatDay(iso: string): string {
  return dayFmt.format(new Date(`${iso}T00:00:00Z`));
}

export function formatLongDay(iso: string): string {
  return longDayFmt.format(new Date(`${iso}T00:00:00Z`));
}

export function formatRange(from: string, to: string): string {
  return from === to ? formatLongDay(from) : `${formatDay(from)} – ${formatLongDay(to)}`;
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function formatHour(h: number): string {
  const suffix = h < 12 ? "am" : "pm";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${suffix}`;
}

export function deltaLabel(days: number): string {
  return days === 1 ? "vs previous day" : `vs previous ${days} days`;
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  CARD: "Card",
  OTHER: "Other",
};
