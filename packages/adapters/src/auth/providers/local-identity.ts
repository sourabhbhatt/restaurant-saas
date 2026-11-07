import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { and, eq, gt, isNull, ne } from "drizzle-orm";

import { generateToken, hashToken, isWellFormedToken } from "@ros/domain/shared/tokens";

import type { Executor } from "@ros/database/providers/postgres/client";
import { sessions } from "@ros/database/providers/postgres/schema";
import type { IdentityProvider } from "../interfaces/identity-provider";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// OWASP-recommended scrypt parameters (N=2^17, r=8, p=1).
const PARAMS = { N: 2 ** 17, r: 8, p: 1, keylen: 64 };
const MAX_MEM = 256 * 1024 * 1024;

export async function hashPasswordScrypt(password: string, params = PARAMS): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: MAX_MEM,
  });
  return [
    "scrypt",
    params.N,
    params.r,
    params.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

export async function verifyPasswordScrypt(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, keyB64] = stored.split("$");
  if (alg !== "scrypt" || !n || !r || !p || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, "base64");
  const key = await scrypt(
    password.normalize("NFKC"),
    Buffer.from(saltB64, "base64"),
    expected.length,
    {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAX_MEM,
    },
  );
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Database-backed sessions with opaque tokens (hash stored, sliding expiry). */
export function createLocalIdentityProvider(
  db: Executor,
  options: { ttlDays: number; now: () => Date; fastHashing?: boolean },
): IdentityProvider {
  const ttlMs = options.ttlDays * 86_400_000;
  // Tests use cheaper parameters; production always uses PARAMS.
  const params = options.fastHashing ? { N: 2 ** 10, r: 8, p: 1, keylen: 64 } : PARAMS;
  return {
    name: "local",
    hashPassword: (password) => hashPasswordScrypt(password, params),
    verifyPassword: verifyPasswordScrypt,
    async issueSession(userId, meta) {
      const token = generateToken();
      const expiresAt = new Date(options.now().getTime() + ttlMs);
      const [row] = await db
        .insert(sessions)
        .values({
          userId,
          tokenHash: await hashToken(token),
          expiresAt,
          ip: meta.ip,
          userAgent: meta.userAgent?.slice(0, 300) ?? null,
        })
        .returning({ id: sessions.id });
      return { token, sessionId: row!.id, expiresAt };
    },
    async resolveSession(token) {
      if (!isWellFormedToken(token)) return null;
      const now = options.now();
      const [row] = await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.tokenHash, await hashToken(token)),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, now),
          ),
        )
        .limit(1);
      if (!row) return null;
      // Sliding expiry, at most one write per hour per session.
      if (now.getTime() - row.lastSeenAt.getTime() > 3_600_000) {
        await db
          .update(sessions)
          .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + ttlMs) })
          .where(eq(sessions.id, row.id));
      }
      return {
        sessionId: row.id,
        userId: row.userId,
        expiresAt: row.expiresAt,
        activeWorkspaceId: row.activeWorkspaceId,
      };
    },
    async revokeSession(token) {
      if (!isWellFormedToken(token)) return;
      await db
        .update(sessions)
        .set({ revokedAt: options.now() })
        .where(eq(sessions.tokenHash, await hashToken(token)));
    },
    async revokeAllSessions(userId, exceptSessionId) {
      await db
        .update(sessions)
        .set({ revokedAt: options.now() })
        .where(
          and(
            eq(sessions.userId, userId),
            isNull(sessions.revokedAt),
            exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined,
          ),
        );
    },
    async setActiveWorkspace(sessionId, workspaceId) {
      await db
        .update(sessions)
        .set({ activeWorkspaceId: workspaceId })
        .where(eq(sessions.id, sessionId));
    },
  };
}
