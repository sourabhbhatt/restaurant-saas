import { defineConfig, devices } from "@playwright/test";

import { E2E_URLS } from "./tests/e2e/support/urls";

const { console: baseURL, ops, admin, api, external } = E2E_URLS;
const port = (url: string) => new URL(url).port;

/** Journeys run once, on the form factor their users have (guests and waiters: phones). */
const DESKTOP_ONLY = [/owner-.*\.spec\.ts/, /operations\.spec\.ts/, /offline\.spec\.ts/];
const MOBILE_ONLY = [/guest\.spec\.ts/, /waiter\.spec\.ts/];

const frontend = (pkg: string, url: string) => ({
  command: `pnpm --filter ${pkg} exec next start -p ${port(url)}`,
  url: `${url}/healthz`,
  env: {
    API_INTERNAL_URL: api,
    CONSOLE_URL: baseURL,
    OPS_URL: ops,
    ADMIN_URL: admin,
  },
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
});

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/support/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : undefined,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // Multi-device journeys against production builds; shared CI runners can be slow.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    // Every animation in the UI kit is motion-safe: without them, actionability checks
    // ("element is stable") never depend on the frame rate of a loaded machine.
    reducedMotion: "reduce",
  },
  projects: [
    // Waiter and customer interfaces are mobile-first; dashboards are desktop-first.
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] }, testIgnore: DESKTOP_ONLY },
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] }, testIgnore: MOBILE_ONLY },
  ],
  // E2E runs against production builds so the service workers are exercised: the API
  // on its own port (fresh seeded PGlite, see support/serve-api.ts) and the console,
  // ops and admin frontends proxying /api/v1 to it.
  webServer: external
    ? undefined
    : [
        {
          command: "pnpm exec tsx tests/e2e/support/serve-api.ts",
          url: `${api}/api/v1/health`,
          env: {
            E2E_API_PORT: port(api),
            APP_URL: baseURL,
            // Mutations are accepted only from listed origins.
            ALLOWED_ORIGINS: [baseURL, ops, admin].join(","),
            TRUSTED_PROXY_HOPS: "1",
          },
          reuseExistingServer: !process.env.CI,
          // Includes building all four apps when turbo has no cached build.
          timeout: 900_000,
        },
        frontend("@ros/console", baseURL),
        frontend("@ros/ops", ops),
        frontend("@ros/admin", admin),
      ],
});
