import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as getSettings, PUT as putSettings } from "@/app/api/v1/admin/settings/route";
import { GET as me } from "@/app/api/v1/auth/me/route";
import { POST as signIn } from "@/app/api/v1/auth/signin/route";
import { POST as signOut } from "@/app/api/v1/auth/signout/route";
import { POST as signUp } from "@/app/api/v1/auth/signup/route";
import { GET as health } from "@/app/api/v1/health/route";
import { GET as ready } from "@/app/api/v1/health/ready/route";
import { POST as runJob } from "@/app/api/v1/jobs/subscriptions/route";
import {
  GET as getWorkspace,
  PATCH as patchWorkspace,
} from "@/app/api/v1/workspaces/[workspaceId]/route";
import { POST as createWorkspace } from "@/app/api/v1/workspaces/route";
import type { AdminSettingsDto } from "@/contracts/platform";
import { connectPglite } from "@/infrastructure/database/providers/postgres/client";
import { buildContainer, setContainerForTests, type Container } from "@/server/container";
import { getEnv, resetEnvCache } from "@/server/config/env";
import { createWorkspaceAs, signUpUser, type TestUser } from "@/test/fixtures";
import { call, createTestContainer, makePlatformAdmin, uniqueEmail } from "@/test/harness";

let c: Container;
beforeAll(async () => {
  c = await createTestContainer();
});
afterAll(() => c.close());

describe("health endpoints", () => {
  it("GET /health is 200 with status and version", async () => {
    const previous = process.env.APP_VERSION;
    delete process.env.APP_VERSION;
    resetEnvCache();
    try {
      const res = await call(health);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ data: { status: "ok", version: "dev" } });
      process.env.APP_VERSION = "1.2.3";
      resetEnvCache();
      expect((await call(health)).body).toEqual({ data: { status: "ok", version: "1.2.3" } });
    } finally {
      if (previous === undefined) delete process.env.APP_VERSION;
      else process.env.APP_VERSION = previous;
      resetEnvCache();
    }
  });

  it("GET /health/ready is 200 when the database answers and migrations are applied", async () => {
    const res = await call(ready);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ status: "ready" });
  });

  it("GET /health/ready is 503 when migrations are pending", async () => {
    const handle = await connectPglite();
    const bare = await buildContainer({
      env: getEnv(),
      database: handle,
      quiet: true,
      syncSystemData: false,
    });
    setContainerForTests(bare);
    try {
      const res = await call(ready);
      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({ code: "INTERNAL_ERROR", message: "not ready" });
    } finally {
      await bare.close();
      setContainerForTests(c);
    }
  });

  it("with the database down, /health is 200 (no database access) and /health/ready is 503", async () => {
    const down = await createTestContainer();
    await down.close();
    try {
      expect((await call(health)).status).toBe(200);
      const res = await call(ready);
      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({ code: "INTERNAL_ERROR", message: "not ready" });
    } finally {
      setContainerForTests(c);
    }
  });
});

describe("maintenance mode", () => {
  const SECRET = "maintenance-cron-secret-0123";
  let admin: TestUser;
  let owner: TestUser;
  let ws: { id: string };

  async function setMaintenance(on: boolean) {
    const current = await call<AdminSettingsDto>(getSettings, { cookie: admin.cookie });
    const res = await call(putSettings, {
      method: "PUT",
      cookie: admin.cookie,
      body: { ...current.body.data!.settings, maintenanceMode: on },
    });
    expect(res.status).toBe(200);
  }

  /** Settings are cached for 10 s; move the clock past that so the next request re-reads them. */
  function expireSettingsCache() {
    c.clock.setOffsetMs(c.clock.offsetMs() + 10_001);
  }

  beforeAll(async () => {
    c.env.CRON_SECRET = SECRET;
    admin = await signUpUser("Maint Admin");
    await makePlatformAdmin(c, admin.userId);
    owner = await signUpUser("Maint Owner");
    ws = await createWorkspaceAs(owner, "Maint WS");
    await setMaintenance(true);
    expireSettingsCache();
  });
  afterAll(async () => {
    await setMaintenance(false);
    expireSettingsCache();
  });

  it("every mutation returns 503 MAINTENANCE", async () => {
    const created = await call(createWorkspace, {
      body: { name: "Blocked" },
      cookie: owner.cookie,
    });
    expect(created.status).toBe(503);
    expect(created.body.error!.code).toBe("MAINTENANCE");

    const patched = await call(patchWorkspace, {
      method: "PATCH",
      params: { workspaceId: ws.id },
      cookie: owner.cookie,
      body: { name: "Renamed" },
    });
    expect(patched.status).toBe(503);
    expect(patched.body.error!.code).toBe("MAINTENANCE");

    const signup = await call(signUp, {
      body: { name: "Late", email: uniqueEmail(), password: "correct-horse-42", acceptTerms: true },
    });
    expect(signup.status).toBe(503);
  });

  it("GET requests still work in maintenance mode", async () => {
    expect((await call(me, { cookie: owner.cookie })).status).toBe(200);
    const got = await call(getWorkspace, { params: { workspaceId: ws.id }, cookie: owner.cookie });
    expect(got.status).toBe(200);
  });

  it("sign-in and sign-out still work", async () => {
    const login = await call(signIn, { body: { email: owner.email, password: owner.password } });
    expect(login.status).toBe(200);
    const out = await call(signOut, { method: "POST", cookie: owner.cookie });
    expect(out.status).toBe(200);
    owner = { ...owner, cookie: login.setCookie!.split(";")[0]! };
  });

  it("job routes (skipOriginCheck) still work", async () => {
    const res = await call(runJob, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    });
    expect(res.status).toBe(200);
  });

  it("Super Admin routes still work, so maintenance can be turned off", async () => {
    await setMaintenance(false);
    // Cached for 10 s: writes stay blocked until the cache expires.
    const cached = await call(createWorkspace, { body: { name: "Soon" }, cookie: admin.cookie });
    expect(cached.status).toBe(503);
    expireSettingsCache();
    const res = await call(createWorkspace, { body: { name: "After" }, cookie: admin.cookie });
    expect(res.status).toBe(201);
    await setMaintenance(true);
    expireSettingsCache();
  });
});
