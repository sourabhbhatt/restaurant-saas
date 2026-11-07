/**
 * Calendar-day ranges in a branch's IANA timezone, converted to UTC instants
 * for querying. Pure (uses only Intl), so reports and lists agree on what
 * "today" means for a branch regardless of the server's timezone.
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

function zonedParts(date: Date, timeZone: string) {
  const parts = formatter(timeZone).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` from UTC at `date`, in ms (IST → +19 800 000). */
export function timezoneOffsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** "YYYY-MM-DD" of `date` as seen in `timeZone`. */
export function localDateString(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

function parseLocalDate(value: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new RangeError(`Invalid local date: ${value}`);
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/** UTC instant of local midnight at the start of `localDate` in `timeZone`. */
export function startOfLocalDay(localDate: string, timeZone: string): Date {
  const { y, m, d } = parseLocalDate(localDate);
  const guess = Date.UTC(y, m - 1, d);
  const first = timezoneOffsetMs(new Date(guess), timeZone);
  let instant = guess - first;
  // Re-check once in case a DST change sits between the guess and the result.
  const second = timezoneOffsetMs(new Date(instant), timeZone);
  if (second !== first) instant = guess - second;
  return new Date(instant);
}

function addDaysToLocalDate(localDate: string, days: number): string {
  const { y, m, d } = parseLocalDate(localDate);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

export interface LocalDayRange {
  from: string;
  to: string;
  /** Inclusive start instant. */
  start: Date;
  /** Exclusive end instant (start of the day after `to`). */
  end: Date;
}

/**
 * Resolve an inclusive local-date range (defaults: today) into UTC instants.
 * Swaps the bounds if they are reversed.
 */
export function localDayRange(
  timeZone: string,
  now: Date,
  from?: string | null,
  to?: string | null,
): LocalDayRange {
  const today = localDateString(now, timeZone);
  let a = from ?? to ?? today;
  let b = to ?? from ?? today;
  if (a > b) [a, b] = [b, a];
  return {
    from: a,
    to: b,
    start: startOfLocalDay(a, timeZone),
    end: startOfLocalDay(addDaysToLocalDate(b, 1), timeZone),
  };
}
