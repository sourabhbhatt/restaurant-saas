import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { request, type FullConfig } from "@playwright/test";

import { AUTH_DIR, DEMO_ACCOUNTS, authFile, type DemoRole } from "./accounts";
import { runIdFile } from "./run-id";
import { E2E_URLS } from "./urls";
import { uniqueIp } from "./ip";

/**
 * The suite writes a lot (tables, orders, payments, new owners and
 * workspaces) to whatever answers behind these URLs.
 * - Local runs: every app must report the APP_VERSION of the throwaway API
 *   that serve-api started for this port (a reused or foreign server, or a
 *   console proxying to another API, is refused before anything is written).
 *   No variable turns this off.
 * - External runs (E2E_BASE_URL): E2E_ALLOW_WRITES must equal that console's
 *   origin, so a stale blanket setting never authorises another target.
 */
async function assertThrowawayStack() {
  const refuse = (why: string, fix: string) => {
    throw new Error(`E2E refused: ${why}. ${fix}`);
  };
  if (E2E_URLS.external) {
    const origin = new URL(E2E_URLS.console).origin;
    if (process.env.E2E_ALLOW_WRITES !== origin)
      refuse(
        `E2E_BASE_URL is set and the suite would write to ${origin}`,
        `Only for a disposable, demo-seeded stack: set E2E_ALLOW_WRITES=${origin}.`,
      );
    return;
  }
  const local = "Stop the servers on these ports and rerun: they are not the throwaway E2E stack.";
  const file = runIdFile(path.resolve(__dirname, "../../.."), new URL(E2E_URLS.api).port);
  if (!existsSync(file)) refuse(`no run id at ${file}`, local);
  const runId = readFileSync(file, "utf8").trim();
  const ctx = await request.newContext();
  try {
    for (const url of [E2E_URLS.api, E2E_URLS.console, E2E_URLS.ops, E2E_URLS.admin]) {
      const res = await ctx.get(`${url}/api/v1/health`);
      const version = res.ok()
        ? ((await res.json()) as { data?: { version?: string } }).data?.version
        : undefined;
      if (version !== runId)
        refuse(`${url} reports version ${version ?? res.status()}, expected ${runId}`, local);
    }
  } finally {
    await ctx.dispose();
  }
}

/**
 * Signs every demo account in once and saves its cookies. Sign-in is limited
 * to 10 attempts per account per 15 minutes, so specs reuse these sessions
 * instead of signing in again (only the sign-in journeys use the form), and a
 * saved session that the server still accepts is kept (repeated local runs
 * against running servers).
 */
export default async function globalSetup(_config: FullConfig) {
  await assertThrowawayStack();
  mkdirSync(AUTH_DIR, { recursive: true });
  const origin = E2E_URLS.console;
  for (const role of Object.keys(DEMO_ACCOUNTS) as DemoRole[]) {
    const { email, password } = DEMO_ACCOUNTS[role];
    const file = authFile(role);
    if (existsSync(file) && (await sessionStillValid(file, email))) continue;
    const ctx = await request.newContext({
      baseURL: origin,
      extraHTTPHeaders: { origin, "x-forwarded-for": uniqueIp() },
    });
    const res = await ctx.post("/api/v1/auth/signin", { data: { email, password } });
    if (res.status() !== 200) {
      throw new Error(`global setup: sign-in as ${email} → ${res.status()} ${await res.text()}`);
    }
    await ctx.storageState({ path: file });
    await ctx.dispose();
  }
}

async function sessionStillValid(file: string, email: string): Promise<boolean> {
  const ctx = await request.newContext({
    baseURL: E2E_URLS.console,
    storageState: file,
    extraHTTPHeaders: { "x-forwarded-for": uniqueIp() },
  });
  try {
    const res = await ctx.get("/api/v1/auth/me");
    if (!res.ok()) return false;
    const me = (await res.json()) as { data?: { user?: { email?: string } } };
    return me.data?.user?.email === email;
  } catch {
    return false;
  } finally {
    await ctx.dispose();
  }
}
