import { and, inArray, isNull } from "drizzle-orm";

import { hashToken } from "@/domain/shared/tokens";

import type { Executor } from "../../database/providers/postgres/client";
import { sessions } from "../../database/providers/postgres/schema";

const SESSION_COOKIE = "ros_session";

/** Cookie values from Netscape cookie-file text; `#HttpOnly_` lines are cookies, other `#` lines are comments. */
function sessionTokens(jarText: string): string[] {
  const tokens = new Set<string>();
  for (const raw of jarText.split(/\r?\n/)) {
    const line = raw.startsWith("#HttpOnly_") ? raw.slice("#HttpOnly_".length) : raw;
    if (!line || line.startsWith("#")) continue;
    const fields = line.split("\t");
    if (fields.length < 7 || fields[5] !== SESSION_COOKIE) continue;
    const value = fields[6]!.trim();
    if (value) tokens.add(value);
  }
  return [...tokens];
}

/** Revokes every session named by a `ros_session` cookie in the jar. Never logs token values. */
export async function revokeSessionsFromCookieJar(
  db: Executor,
  jarText: string,
  now: Date,
): Promise<{ found: number; revoked: number }> {
  const tokens = sessionTokens(jarText);
  if (tokens.length === 0) return { found: 0, revoked: 0 };
  const hashes = await Promise.all(tokens.map(hashToken));
  const updated = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(inArray(sessions.tokenHash, hashes), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return { found: tokens.length, revoked: updated.length };
}
