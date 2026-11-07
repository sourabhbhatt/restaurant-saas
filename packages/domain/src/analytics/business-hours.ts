import { weekdayOf, enumerateDates } from "./date-range";

/**
 * Opening-hours arithmetic for table occupancy. Occupancy % is an
 * approximation: minutes tables were held by a session divided by
 * (active tables × minutes the branch was open in the period).
 */

export interface OpeningHoursDay {
  day: number;
  closed: boolean;
  /** "HH:MM", 24h, branch local time. */
  open: string;
  close: string;
}

/** Used when a branch has not configured business hours. */
export const DEFAULT_OPEN_MINUTES_PER_DAY = 12 * 60;

function minutesOf(hhmm: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/**
 * Minutes a branch is open on a weekday. Overnight hours (close ≤ open, e.g.
 * 18:00–02:00) wrap past midnight; "00:00–00:00" means open 24 hours. A day
 * missing from a configured schedule, or with unparsable times, uses the
 * default.
 */
export function openMinutesForWeekday(hours: readonly OpeningHoursDay[], weekday: number): number {
  if (hours.length === 0) return DEFAULT_OPEN_MINUTES_PER_DAY;
  const entry = hours.find((h) => h.day === weekday);
  if (!entry) return DEFAULT_OPEN_MINUTES_PER_DAY;
  if (entry.closed) return 0;
  const open = minutesOf(entry.open);
  const close = minutesOf(entry.close);
  if (open === null || close === null) return DEFAULT_OPEN_MINUTES_PER_DAY;
  const diff = close - open;
  return diff > 0 ? diff : diff + 24 * 60;
}

export function openMinutesInRange(
  hours: readonly OpeningHoursDay[],
  from: string,
  to: string,
): number {
  return enumerateDates(from, to).reduce(
    (sum, d) => sum + openMinutesForWeekday(hours, weekdayOf(d)),
    0,
  );
}

/** Occupancy percentage (0–100, one decimal), or null when nothing was open. */
export function occupancyPercent(
  occupiedMinutes: number,
  tables: number,
  openMinutes: number,
): number | null {
  const capacity = tables * openMinutes;
  if (capacity <= 0) return null;
  return Math.min(100, Math.round((occupiedMinutes / capacity) * 1000) / 10);
}
