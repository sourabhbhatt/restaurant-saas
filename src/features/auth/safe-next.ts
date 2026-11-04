/**
 * Validate a `?next=` redirect target. Only same-origin relative paths are
 * accepted ("/app/w/123"); anything else ("//evil.com", "https://…",
 * "/\\evil.com", "javascript:…") falls back. Auth pages are never a target,
 * which avoids redirect loops.
 */
export function safeNextPath(raw: string | null | undefined, fallback: string): string {
  if (!raw || raw.length > 2048) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  // Control characters and backslashes can be normalised by browsers into a host.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return fallback;
  try {
    const base = "http://same-origin.invalid";
    const url = new URL(raw, base);
    if (url.origin !== base) return fallback;
    const path = `${url.pathname}${url.search}${url.hash}`;
    if (/^\/(sign-in|sign-up|forgot-password|reset-password)(\/|$|\?|#)/.test(path)) return fallback;
    return path;
  } catch {
    return fallback;
  }
}
