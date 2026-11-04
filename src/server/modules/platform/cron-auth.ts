import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Scheduled-job authentication: `Authorization: Bearer <CRON_SECRET>`.
 * Constant-time comparison of SHA-256 digests (equal length regardless of
 * input), and always false when no secret is configured.
 */
export function isAuthorizedCron(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  const presented = match?.[1]?.trim() ?? "";
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b) && presented.length > 0;
}
