const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "just now", "5 minutes ago", "yesterday", or a short date for older times. */
export function relativeTime(at: number | string | Date, now: number = Date.now()): string {
  const ms = typeof at === "number" ? at : new Date(at).getTime();
  const diff = ms - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) return "just now";
  if (abs < 60 * 60_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 24 * 60 * 60_000) return rtf.format(Math.round(diff / (60 * 60_000)), "hour");
  if (abs < 7 * 24 * 60 * 60_000) return rtf.format(Math.round(diff / (24 * 60 * 60_000)), "day");
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Absolute timestamp for tooltips / `title` attributes. */
export function absoluteTime(at: number | string | Date): string {
  return new Date(at).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
