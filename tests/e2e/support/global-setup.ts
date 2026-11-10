import { existsSync, mkdirSync } from "node:fs";

import { request, type FullConfig } from "@playwright/test";

import { AUTH_DIR, DEMO_ACCOUNTS, authFile, type DemoRole } from "./accounts";
import { E2E_URLS } from "./urls";
import { uniqueIp } from "./ip";

/**
 * Signs every demo account in once and saves its cookies. Sign-in is limited
 * to 10 attempts per account per 15 minutes, so specs reuse these sessions
 * instead of signing in again (only the sign-in journeys use the form), and a
 * saved session that the server still accepts is kept (repeated local runs
 * against running servers).
 */
export default async function globalSetup(_config: FullConfig) {
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
