import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { request, type FullConfig } from "@playwright/test";

import { AUTH_DIR, DEMO_ACCOUNTS, authFile, type DemoRole } from "./accounts";
import { runIdFile } from "./run-id";
import { E2E_URLS } from "./urls";
import { uniqueIp } from "./ip";

/**
 * The suite writes a lot (tables, orders, payments, new owners and
 * workspaces) to whatever answers behind these URLs. Unless
 * E2E_ALLOW_WRITES=1, every app must report the APP_VERSION of the throwaway
 * API that serve-api started for this port (a reused or foreign server, or a
 * console proxying to another API, is refused before anything is written).
 */
async function assertThrowawayStack() {
  if (process.env.E2E_ALLOW_WRITES === "1") return;
  const refuse = (why: string) => {
    throw new Error(
      `E2E refused: ${why}. The servers on these ports are not the throwaway E2E stack. ` +
        "Stop them and rerun, or set E2E_ALLOW_WRITES=1 for a disposable, demo-seeded stack.",
    );
  };
  if (E2E_URLS.external) refuse("E2E_BASE_URL is set");
  const file = runIdFile(path.resolve(__dirname, "../../.."), new URL(E2E_URLS.api).port);
  if (!existsSync(file)) refuse(`no run id at ${file}`);
  const runId = readFileSync(file, "utf8").trim();
  const ctx = await request.newContext();
  try {
    for (const url of [E2E_URLS.api, E2E_URLS.console, E2E_URLS.ops, E2E_URLS.admin]) {
      const res = await ctx.get(`${url}/api/v1/health`);
      const version = res.ok()
        ? ((await res.json()) as { data?: { version?: string } }).data?.version
        : undefined;
      if (version !== runId)
        refuse(`${url} reports version ${version ?? res.status()}, expected ${runId}`);
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
