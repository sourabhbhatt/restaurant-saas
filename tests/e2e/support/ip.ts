import { randomInt } from "node:crypto";

/**
 * A distinct client address per browser/API context. The API rate-limits by
 * client IP (from X-Forwarded-For, TRUSTED_PROXY_HOPS=1), so parallel specs
 * must not share one bucket.
 */
export function uniqueIp(): string {
  return `10.${randomInt(1, 255)}.${randomInt(0, 256)}.${randomInt(1, 255)}`;
}
