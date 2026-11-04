import { validationFailed } from "../shared/errors";

/**
 * Reporting periods. A range is a pair of inclusive local calendar dates
 * ("YYYY-MM-DD") interpreted in each branch's own time zone. Calendar
 * arithmetic is done on the date strings in UTC so it never depends on the
 * server's time zone or DST.
 */

export const MAX_RANGE_DAYS = 366;
export const DEFAULT_RANGE_DAYS = 7;

const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function toUtc(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function addDaysIso(date: string, days: number): string {
  return new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive number of calendar days from `from` to `to`. */
export function daysInclusive(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS) + 1;
}

/** Every date from `from` to `to` inclusive. */
export function enumerateDates(from: string, to: string): string[] {
  const n = daysInclusive(from, to);
  return Array.from({ length: Math.max(0, n) }, (_, i) => addDaysIso(from, i));
}

/** 0 = Sunday … 6 = Saturday, matching Postgres `extract(dow ...)`. */
export function weekdayOf(date: string): number {
  return new Date(toUtc(date)).getUTCDay();
}

/** The calendar date of `now` in an IANA time zone (falls back to UTC for unknown zones). */
export function localDate(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export interface ResolvedRange {
  from: string;
  to: string;
  days: number;
  /** The equally long period immediately before `from`, for deltas. */
  previousFrom: string;
  previousTo: string;
}

/**
 * Fill in a requested range. Defaults to the last 7 days ending `today`.
 * Throws VALIDATION_FAILED when `from` is after `to` or the span exceeds
 * 366 days.
 */
export function resolveRange(input: { from?: string; to?: string }, today: string): ResolvedRange {
  let { from, to } = input;
  if (!from && !to) {
    to = today;
    from = addDaysIso(today, -(DEFAULT_RANGE_DAYS - 1));
  } else if (from && !to) {
    to = from > today ? from : today;
  } else if (!from && to) {
    from = addDaysIso(to, -(DEFAULT_RANGE_DAYS - 1));
  }
  const f = from!;
  const t = to!;
  if (!isIsoDate(f)) throw validationFailed("Invalid start date", { from: ["Use YYYY-MM-DD"] });
  if (!isIsoDate(t)) throw validationFailed("Invalid end date", { to: ["Use YYYY-MM-DD"] });
  if (f > t) {
    throw validationFailed("The start date must be on or before the end date", {
      from: ["Must be on or before the end date"],
    });
  }
  const days = daysInclusive(f, t);
  if (days > MAX_RANGE_DAYS) {
    throw validationFailed(`Choose a period of at most ${MAX_RANGE_DAYS} days`, {
      to: [`At most ${MAX_RANGE_DAYS} days`],
    });
  }
  const previousTo = addDaysIso(f, -1);
  return { from: f, to: t, days, previousTo, previousFrom: addDaysIso(previousTo, -(days - 1)) };
}

/**
 * Percentage change from `previous` to `current`, rounded to 0.1. Null when
 * there is no baseline (previous is zero), so the UI can show "new" instead
 * of an infinite percentage.
 */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return Math.round(((current - previous) / Math.abs(previous)) * 1000) / 10;
}
