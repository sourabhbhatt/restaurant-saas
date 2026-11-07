import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_PLATFORM_SETTINGS } from "@ros/domain/platform/settings";
import { GET as me } from "@/app/api/v1/auth/me/route";
import { POST as forgot } from "@/app/api/v1/auth/forgot-password/route";
import { POST as reset } from "@/app/api/v1/auth/reset-password/route";
import { POST as signIn } from "@/app/api/v1/auth/signin/route";
import { POST as signOut } from "@/app/api/v1/auth/signout/route";
import { POST as signUp } from "@/app/api/v1/auth/signup/route";
import { GET as getEntitlements } from "@/app/api/v1/workspaces/[workspaceId]/entitlements/route";
import {
  GET as getWorkspace,
  PATCH as patchWorkspace,
} from "@/app/api/v1/workspaces/[workspaceId]/route";
import { emailOutbox } from "@ros/database/providers/postgres/schema";
import { resetEnvCache } from "@ros/application/config/env";
import { setContainerForTests, type Container } from "@/composition/container";
import { call, cookieFrom, createTestContainer, uniqueEmail } from "@/test/harness";
import { createWorkspaceAs, signUpUser } from "@/test/fixtures";
import { desc, eq } from "drizzle-orm";

let c: Container;
beforeAll(async () => {
  c = await createTestContainer();
});
afterAll(async () => {
  await c.close();
});

describe("authentication", () => {
  it("signs up, reads the session and signs out", async () => {
    const user = await signUpUser("Asha Rao");
    const meRes = await call<{ user: { email: string } }>(me, { cookie: user.cookie });
    expect(meRes.status).toBe(200);
    expect(meRes.body.data!.user.email).toBe(user.email);

    const out = await call(signOut, { method: "POST", cookie: user.cookie });
    expect(out.status).toBe(200);
    expect((await call(me, { cookie: user.cookie })).status).toBe(401);
  });

  it("rejects duplicate emails with a field error", async () => {
    const user = await signUpUser();
    const res = await call(signUp, {
      body: { name: "Dup", email: user.email, password: "another-pass-1", acceptTerms: true },
    });
    expect(res.status).toBe(409);
    expect(res.body.error?.fieldErrors?.email).toBeDefined();
  });

  it("validates input with field-level messages", async () => {
    const res = await call(signUp, {
      body: { name: "A", email: "nope", password: "short", acceptTerms: false },
    });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error!.fieldErrors!)).toEqual(
      expect.arrayContaining(["name", "email", "password"]),
    );
  });

  it("uses one generic message for wrong password and unknown email", async () => {
    const user = await signUpUser();
    const wrong = await call(signIn, { body: { email: user.email, password: "wrong-password-1" } });
    const unknown = await call(signIn, {
      body: { email: uniqueEmail("ghost"), password: "wrong-password-1" },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error!.message).toBe(unknown.body.error!.message);
  });

  it("resets a password with a single-use token and revokes old sessions", async () => {
    const user = await signUpUser();
    expect((await call(forgot, { body: { email: user.email } })).status).toBe(200);
    const [mail] = await c.db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.toAddress, user.email))
      .orderBy(desc(emailOutbox.createdAt))
      .limit(1);
    expect(mail?.template).toBe("reset_password");
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mail!.textBody)![1]!);

    const ok = await call(reset, { body: { token, password: "brand-new-pass-9" } });
    expect(ok.status).toBe(200);
    const again = await call(reset, { body: { token, password: "brand-new-pass-9" } });
    expect(again.status).toBe(422);

    expect((await call(me, { cookie: user.cookie })).status).toBe(401);
    const login = await call(signIn, { body: { email: user.email, password: "brand-new-pass-9" } });
    expect(login.status).toBe(200);
    expect(cookieFrom(login.setCookie)).toMatch(/^ros_session=/);
  });

  it("blocks cross-site mutations that carry a cookie", async () => {
    const user = await signUpUser();
    const res = await call(signOut, {
      method: "POST",
      cookie: user.cookie,
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
  });
});

describe("allowed origins", () => {
  const ALLOWED = ["https://a.example", "https://b.example", "https://c.example:8443"];
  let local: Container;
  let previous: string | undefined;
  beforeAll(async () => {
    previous = process.env.ALLOWED_ORIGINS;
    process.env.ALLOWED_ORIGINS = "https://a.example, https://b.example/app,https://c.example:8443";
    local = await createTestContainer();
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.ALLOWED_ORIGINS;
    else process.env.ALLOWED_ORIGINS = previous;
    resetEnvCache();
    await local.close();
    setContainerForTests(c);
  });

  // A cookie forces the Origin check; it need not belong to a real session.
  const cookie = "ros_session=not-a-real-session";

  it("mutation from each allowed origin passes", async () => {
    expect(local.env.ALLOWED_ORIGINS).toEqual(ALLOWED);
    for (const origin of ALLOWED) {
      const res = await call(signOut, { method: "POST", cookie, origin });
      expect(res.status, origin).toBe(200);
    }
  });

  it("mutation from an unlisted origin is 403", async () => {
    const res = await call(signOut, { method: "POST", cookie, origin: "https://d.example" });
    expect(res.status).toBe(403);
  });

  it("request whose Host matches but Origin is unlisted is 403", async () => {
    // The harness sends requests to http://localhost:3000; that origin is not in the list.
    const res = await call(signOut, { method: "POST", cookie, origin: "http://localhost:3000" });
    expect(res.status).toBe(403);
  });
});

describe("workspaces", () => {
  it("creates a workspace with an owner membership and the default trial", async () => {
    const owner = await signUpUser("Owner");
    const ws = await createWorkspaceAs(owner, "Spice Route Group");
    const ent = await call<{
      entitlements: { phase: string; trialDaysRemaining: number; planKey: string };
    }>(getEntitlements, { params: { workspaceId: ws.id }, cookie: owner.cookie });
    expect(ent.status).toBe(200);
    expect(ent.body.data!.entitlements.phase).toBe("TRIAL");
    expect(ent.body.data!.entitlements.trialDaysRemaining).toBe(
      DEFAULT_PLATFORM_SETTINGS.trialDays,
    );
    expect(ent.body.data!.entitlements.planKey).toBe("pro");
  });

  it("does not reveal another workspace (IDOR) and rejects stale updates", async () => {
    const a = await signUpUser("Alpha");
    const b = await signUpUser("Bravo");
    const wsA = await createWorkspaceAs(a, "A Foods");
    const asB = await call(getWorkspace, { params: { workspaceId: wsA.id }, cookie: b.cookie });
    expect(asB.status).toBe(404);
    const patchAsB = await call(patchWorkspace, {
      method: "PATCH",
      params: { workspaceId: wsA.id },
      cookie: b.cookie,
      body: { name: "Hijacked" },
    });
    expect(patchAsB.status).toBe(404);

    const ok = await call<{ version: number }>(patchWorkspace, {
      method: "PATCH",
      params: { workspaceId: wsA.id },
      cookie: a.cookie,
      body: { name: "A Foods Pvt", version: 1 },
    });
    expect(ok.status).toBe(200);
    const stale = await call(patchWorkspace, {
      method: "PATCH",
      params: { workspaceId: wsA.id },
      cookie: a.cookie,
      body: { name: "Again", version: 1 },
    });
    expect(stale.status).toBe(409);
  });
});

describe("trusted proxy client IP", () => {
  it("sign-in limit cannot be bypassed by rotating X-Forwarded-For", async () => {
    const previous = process.env.TRUSTED_PROXY_HOPS;
    process.env.TRUSTED_PROXY_HOPS = "1";
    resetEnvCache();
    const local = await createTestContainer();
    try {
      // 30 per IP per 15 minutes: one rotating client, 31 attempts, distinct accounts.
      let last = 0;
      for (let i = 0; i < 31; i++) {
        const res = await call(signIn, {
          body: { email: uniqueEmail(), password: "wrong-password-1" },
          headers: {
            "x-forwarded-for": `10.0.${Math.floor(i / 250)}.${(i % 250) + 1}, 203.0.113.9`,
          },
        });
        last = res.status;
      }
      expect(last).toBe(429);
    } finally {
      if (previous === undefined) delete process.env.TRUSTED_PROXY_HOPS;
      else process.env.TRUSTED_PROXY_HOPS = previous;
      resetEnvCache();
      await local.close();
      setContainerForTests(c);
    }
  });
});

describe("per-account throttling", () => {
  let local: Container;
  let previous: string | undefined;
  beforeAll(async () => {
    previous = process.env.TRUSTED_PROXY_HOPS;
    process.env.TRUSTED_PROXY_HOPS = "1";
    resetEnvCache();
    local = await createTestContainer();
  });
  afterAll(async () => {
    if (previous === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = previous;
    resetEnvCache();
    await local.close();
    setContainerForTests(c);
  });

  const fromIp = (i: number) => ({ "x-forwarded-for": `198.51.100.${i}` });

  it("11th sign-in for one email from 11 different IPs is rate limited", async () => {
    const email = uniqueEmail();
    let last;
    for (let i = 1; i <= 11; i++) {
      last = await call(signIn, {
        body: { email, password: "wrong-password-1" },
        headers: fromIp(i),
      });
    }
    expect(last!.status).toBe(429);
    expect(last!.body.error?.code).toBe("RATE_LIMITED");
  });

  it("correct password during lockout is still rate limited", async () => {
    const user = await signUpUser();
    for (let i = 1; i <= 10; i++) {
      await call(signIn, {
        body: { email: user.email, password: "wrong-password-1" },
        headers: fromIp(i),
      });
    }
    const res = await call(signIn, {
      body: { email: user.email.toUpperCase(), password: user.password },
      headers: fromIp(50),
    });
    expect(res.status).toBe(429);
    expect(res.body.error?.code).toBe("RATE_LIMITED");
  });

  it("4th forgot-password for one email within an hour returns 200 but queues no 4th email", async () => {
    const user = await signUpUser();
    for (let i = 1; i <= 4; i++) {
      const res = await call(forgot, { body: { email: user.email }, headers: fromIp(100 + i) });
      expect(res.status).toBe(200);
    }
    const mails = await local.db
      .select()
      .from(emailOutbox)
      .where(eq(emailOutbox.toAddress, user.email));
    expect(mails.filter((m) => m.template === "reset_password")).toHaveLength(3);
  });
});
