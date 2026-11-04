import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as mailbox } from "@/app/api/v1/dev/mailbox/route";
import type { DevMailboxEmailDto } from "@/contracts/dev-mailbox";
import type { Container } from "@/server/container";
import { call, createTestContainer } from "@/test/harness";
import { signUpUser } from "@/test/fixtures";

let c: Container;
beforeAll(async () => {
  c = await createTestContainer();
});
afterAll(async () => {
  await c.close();
});

function setEnv(patch: {
  ENABLE_TEST_HOOKS?: boolean;
  NODE_ENV?: "development" | "test" | "production";
}) {
  Object.assign(c.env as Record<string, unknown>, patch);
}

describe("GET /api/v1/dev/mailbox", () => {
  it("returns the latest outbox emails, newest first, when test hooks are enabled", async () => {
    setEnv({ ENABLE_TEST_HOOKS: true, NODE_ENV: "test" });
    const user = await signUpUser("Mailbox Tester");

    const res = await call<DevMailboxEmailDto[]>(mailbox, { path: "/api/v1/dev/mailbox" });
    expect(res.status).toBe(200);
    const emails = res.body.data!;
    expect(emails.length).toBeGreaterThan(0);
    expect(emails.length).toBeLessThanOrEqual(50);
    const mine = emails.find((e) => e.to === user.email);
    expect(mine).toBeDefined();
    expect(mine!.text).toMatch(/https?:\/\/\S+verify-email\?token=/);
    const times = emails.map((e) => Date.parse(e.createdAt));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("caps the list at 50 rows", async () => {
    for (let i = 0; i < 52; i++) {
      await c.repos.emailOutbox.enqueue({
        to: `bulk${i}@example.com`,
        subject: `Bulk ${i}`,
        template: "test",
        text: "hello",
        html: null,
        provider: "outbox",
        delivered: false,
      });
    }
    const res = await call<DevMailboxEmailDto[]>(mailbox, { path: "/api/v1/dev/mailbox" });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(50);
  });

  it("is enabled in development without test hooks", async () => {
    setEnv({ ENABLE_TEST_HOOKS: false, NODE_ENV: "development" });
    const res = await call(mailbox, { path: "/api/v1/dev/mailbox" });
    expect(res.status).toBe(200);
  });

  it("returns 404 outside development when test hooks are disabled", async () => {
    for (const NODE_ENV of ["production", "test"] as const) {
      setEnv({ ENABLE_TEST_HOOKS: false, NODE_ENV });
      const res = await call(mailbox, { path: "/api/v1/dev/mailbox" });
      expect(res.status).toBe(404);
      expect(res.body.error?.code).toBe("NOT_FOUND");
      expect(res.body.data).toBeUndefined();
    }
    setEnv({ ENABLE_TEST_HOOKS: true, NODE_ENV: "test" });
  });
});
