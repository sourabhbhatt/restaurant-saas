import { isIP } from "node:net";

import {
  verifySignedClientIp,
  type SignedClientIpResult,
} from "@ros/domain/shared/signed-client-ip";

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

export type ClientIpRejection = Exclude<SignedClientIpResult, { ok: true }>["reason"];

export interface ResolveClientIpOptions {
  trustedHops: number;
  /** `PROXY_SHARED_SECRET`; undefined disables the signed header entirely. */
  proxySecret: string | undefined;
  now: Date;
  /** Called when signed headers were present but refused (never for absent headers). */
  onRejected?: (reason: ClientIpRejection) => void;
}

/**
 * The client IP for rate limits and audit. A frontend proxy that shares
 * `PROXY_SHARED_SECRET` forwards the browser's address in a signed header
 * (see `@ros/domain/shared/signed-client-ip`), which wins because the proxy
 * sits behind the same platform front end as the API and is otherwise
 * indistinguishable from any other direct caller. Without the secret, or when
 * the signature is missing, stale or wrong, the X-Forwarded-For rule applies.
 */
export async function resolveClientIp(
  headers: Headers,
  options: ResolveClientIpOptions,
): Promise<string | null> {
  if (options.proxySecret) {
    const result = await verifySignedClientIp(headers, {
      secret: options.proxySecret,
      nowMs: options.now.getTime(),
    });
    if (result.ok) {
      if (isIP(result.ip)) return result.ip;
      options.onRejected?.("malformed");
    } else if (result.reason !== "missing") {
      options.onRejected?.(result.reason);
    }
  }
  return clientIpFrom(headers, options.trustedHops);
}
