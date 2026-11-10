import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as signIn } from "@/app/api/v1/auth/signin/route";
import { POST as signUp } from "@/app/api/v1/auth/signup/route";
import { sessions } from "@ros/database/providers/postgres/schema";
import { resetEnvCache } from "@ros/application/config/env";
import { CLIENT_IP_HEADER, signClientIp } from "@ros/domain/shared/signed-client-ip";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, uniqueEmail } from "@/test/harness";
import { createTestContainer } from "@/test/harness";
import { desc, eq } from "drizzle-orm";

/**
 * Behind Cloud Run every browser request reaches the API from a frontend's
 * egress address, so X-Forwarded-For alone puts every user in one rate-limit
 * bucket. The frontend proxy forwards the real address in a header signed with
 * PROXY_SHARED_SECRET; this suite proves the limiter keys on that address and
 * that nobody can claim one without the secret.
 */
const secret = "integration-proxy-shared-secret-0123456789";
// The address the API sees for every proxied request.
const egress = "34.93.0.10";
const previous: Record<string, string | undefined> = {};
let c: Container;

beforeAll(async () => {
  for (const key of ["TRUSTED_PROXY_HOPS", "PROXY_SHARED_SECRET"]) previous[key] = process.env[key];
  process.env.TRUSTED_PROXY_HOPS = "1";
  process.env.PROXY_SHARED_SECRET = secret;
  resetEnvCache();
  c = await createTestContainer();
});
afterAll(async () => {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetEnvCache();
  await c.close();
  setContainerForTests(undefined);
});

const viaProxy = async (clientIp: string, key = secret) => ({
  "x-forwarded-for": `${clientIp}, ${egress}`,
  ...(await signClientIp({ ip: clientIp, secret: key })),
});

const failedSignIn = (headers: Record<string, string>) =>
  call(signIn, { body: { email: uniqueEmail(), password: "wrong-password-1" }, headers });
/** One more than the sign-in route's per-IP limit (30 per 15 minutes). */
const OVER_LIMIT = 31;

describe("rate limiting keys on the signed client IP", () => {
  it("one client exhausting the sign-in limit does not block another behind the same proxy", async () => {
    let last = 0;
    for (let i = 0; i < OVER_LIMIT; i++) {
      last = (await failedSignIn(await viaProxy("203.0.113.10"))).status;
    }
    expect(last).toBe(429);
    // Same egress address, different browser: its own bucket.
    const other = await failedSignIn(await viaProxy("203.0.113.11"));
    expect(other.status).toBe(401);
    // And the first client stays limited.
    expect((await failedSignIn(await viaProxy("203.0.113.10"))).status).toBe(429);
  });

  it("a direct caller cannot claim another address without the secret", async () => {
    // Unsigned header, forged signature, and a signature with the wrong secret all fall back to
    // X-Forwarded-For, i.e. the caller's own (egress) address: the same bucket for all three.
    const attempts: Record<string, string>[] = [
      { "x-forwarded-for": `9.9.9.9, ${egress}`, [CLIENT_IP_HEADER]: "198.51.100.1" },
      {
        "x-forwarded-for": `9.9.9.9, ${egress}`,
        [CLIENT_IP_HEADER]: "198.51.100.2",
        "x-ros-client-ip-signature": "v1.1.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
      await viaProxy("198.51.100.3", "not-the-shared-secret-0123456789"),
    ];
    let last = 0;
    for (let i = 0; i < OVER_LIMIT; i++) {
      last = (await failedSignIn(attempts[i % attempts.length]!)).status;
    }
    expect(last).toBe(429);
  });

  it("a signature replayed after the window falls back to X-Forwarded-For", async () => {
    const stale = {
      "x-forwarded-for": `9.9.9.9, ${egress}`,
      ...(await signClientIp({ ip: "198.51.100.9", secret, nowMs: Date.now() - 10 * 60_000 })),
    };
    // The egress bucket is already exhausted by the previous test.
    expect((await failedSignIn(stale)).status).toBe(429);
    // A fresh signature for a new address is not.
    expect((await failedSignIn(await viaProxy("198.51.100.9"))).status).toBe(401);
  });

  it("the session and audit trail record the signed address", async () => {
    const email = uniqueEmail();
    const res = await call<{ user: { id: string } }>(signUp, {
      body: { name: "Proxy User", email, password: "correct-horse-42", acceptTerms: true },
      headers: await viaProxy("203.0.113.77"),
    });
    expect(res.status).toBe(201);
    const [session] = await c.db
      .select({ ip: sessions.ip })
      .from(sessions)
      .where(eq(sessions.userId, res.body.data!.user.id))
      .orderBy(desc(sessions.createdAt))
      .limit(1);
    expect(session?.ip).toBe("203.0.113.77");
  });
});
