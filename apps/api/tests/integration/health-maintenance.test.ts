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
import type { AdminSettingsDto } from "@ros/contracts/platform";
import { connectPglite } from "@ros/database/providers/postgres/client";
import { platformSettings } from "@ros/database/providers/postgres/schema";
import { buildContainer, setContainerForTests, type Container } from "@/composition/container";
import { getEnv, resetEnvCache } from "@ros/application/config/env";
import { setContainerFactory } from "@ros/application/container";
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
      expect(res.body.error).toMatchObject({ code: "SERVICE_UNAVAILABLE", message: "not ready" });
      expect(res.headers.get("retry-after")).toBe("5");
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
      expect(res.body.error).toMatchObject({ code: "SERVICE_UNAVAILABLE", message: "not ready" });
      expect(res.headers.get("retry-after")).toBe("5");
    } finally {
      setContainerForTests(c);
    }
  });
});

describe("database unavailable", () => {
  const refused = () =>
    Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), {
      code: "ECONNREFUSED",
    });

  it("a request that hits a dropped connection gets a clean 503 with Retry-After and no internals", async () => {
    const captured: unknown[] = [];
    const warnings: string[] = [];
    const broken: Container = {
      ...c,
      errors: { capture: (error) => captured.push(error) },
      logger: { ...c.logger, warn: (message) => warnings.push(message) },
      repos: {
        ...c.repos,
        rateLimit: {
          hit: async () => {
            throw refused();
          },
        },
      },
    };
    setContainerForTests(broken);
    try {
      const res = await call(signIn, { body: { email: uniqueEmail(), password: "whatever-1" } });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatchObject({ code: "SERVICE_UNAVAILABLE" });
      expect(res.headers.get("retry-after")).toBe("5");
      expect(JSON.stringify(res.body)).not.toContain("10.0.0.5");
      expect(JSON.stringify(res.body)).not.toContain("at ");
      // One warning per request, never an incident per request.
      expect(captured).toEqual([]);
      expect(warnings).toContain("dependency_unavailable");
    } finally {
      setContainerForTests(c);
    }
  });

  it("pg's code-less 'Connection terminated unexpectedly' is a 503 too", async () => {
    const broken: Container = {
      ...c,
      repos: {
        ...c.repos,
        rateLimit: {
          hit: async () => {
            throw new Error("Connection terminated unexpectedly");
          },
        },
      },
    };
    setContainerForTests(broken);
    try {
      const res = await call(signIn, { body: { email: uniqueEmail(), password: "whatever-1" } });
      expect(res.status).toBe(503);
      expect(res.body.error?.code).toBe("SERVICE_UNAVAILABLE");
    } finally {
      setContainerForTests(c);
    }
  });

  it("a server shutdown SQLSTATE from the driver is also a 503", async () => {
    const broken: Container = {
      ...c,
      identity: {
        ...c.identity,
        resolveSession: async () => {
          throw Object.assign(new Error("terminating connection due to administrator command"), {
            code: "57P01",
          });
        },
      },
    };
    setContainerForTests(broken);
    try {
      const res = await call(me, { cookie: "ros_session=" + "a".repeat(43) });
      expect(res.status).toBe(503);
      expect(res.body.error?.code).toBe("SERVICE_UNAVAILABLE");
    } finally {
      setContainerForTests(c);
    }
  });

  it("when the container itself cannot be built because the database is down, the API answers 503, not 500", async () => {
    setContainerForTests(undefined);
    setContainerFactory(() => Promise.reject(refused()));
    try {
      const res = await call(health);
      expect(res.status).toBe(200); // liveness never needs the database
      const api = await call(me);
      expect(api.status).toBe(503);
      expect(api.body.error?.code).toBe("SERVICE_UNAVAILABLE");
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

  let previousSecret: string | undefined;

  beforeAll(async () => {
    previousSecret = c.env.CRON_SECRET;
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
    c.env.CRON_SECRET = previousSecret;
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

  it("Super Admin routes still work; turning maintenance off applies at once in this process", async () => {
    await setMaintenance(false);
    const res = await call(createWorkspace, { body: { name: "After" }, cookie: admin.cookie });
    expect(res.status).toBe(201);
  });

  it("a change made by another instance applies once the 10 s cache expires", async () => {
    // Prime the cache with "off", then flip the row directly, as another instance would.
    await call(signUp, {
      body: {
        name: "Primer",
        email: uniqueEmail(),
        password: "correct-horse-42",
        acceptTerms: true,
      },
    });
    await c.db
      .insert(platformSettings)
      .values({ key: "maintenanceMode", value: true })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value: true } });
    const stale = await call(signUp, {
      body: {
        name: "Stale",
        email: uniqueEmail(),
        password: "correct-horse-42",
        acceptTerms: true,
      },
    });
    expect(stale.status).toBe(201);
    expireSettingsCache();
    const fresh = await call(signUp, {
      body: {
        name: "Fresh",
        email: uniqueEmail(),
        password: "correct-horse-42",
        acceptTerms: true,
      },
    });
    expect(fresh.status).toBe(503);
  });
});
