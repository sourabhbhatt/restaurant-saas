import { isIP } from "node:net";

/**
 * Client IP from X-Forwarded-For, trusting only the proxies we operate. Each
 * trusted proxy appends the address it received the request from, so the
 * n-th entry from the right is the first one we did not control; anything to
 * its left is client-supplied and spoofable. With no trusted proxy the header
 * is ignored entirely.
 */
export function clientIpFrom(headers: Headers, trustedHops: number): string | null {
  if (trustedHops <= 0) return null;
  const entries = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length < trustedHops) return null;
  const candidate = entries[entries.length - trustedHops]!;
  return isIP(candidate) ? candidate : null;
}
