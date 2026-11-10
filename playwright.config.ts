import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4100);
const OPS_PORT = Number(process.env.E2E_OPS_PORT ?? 3101);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
/** E2E_SKIP_BUILD=1 starts the existing production builds (a second run with other env, e.g. CI's analytics step). */
const build = (app: string) =>
  process.env.E2E_SKIP_BUILD ? "" : `pnpm --filter @ros/${app} build && `;
/** Staff flows (waiter, kitchen, cashier) live in the ops app. */
export const opsURL = process.env.E2E_OPS_URL ?? `http://localhost:${OPS_PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    // Waiter and customer interfaces are mobile-first; dashboards are desktop-first.
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
  ],
  // E2E runs against production builds so the service worker is exercised: the
  // API on its own port, with console and ops each proxying /api/v1 to it.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: `${build("api")}pnpm --filter @ros/api exec next start -p ${API_PORT}`,
          url: `http://localhost:${API_PORT}/api/v1/health`,
          // APP_URL may name another port; mutations are accepted only from listed origins.
          env: {
            ALLOWED_ORIGINS:
              process.env.ALLOWED_ORIGINS ?? `${new URL(baseURL).origin},${new URL(opsURL).origin}`,
            TRUSTED_PROXY_HOPS: "1",
          },
          reuseExistingServer: !process.env.CI,
          timeout: 240_000,
        },
        {
          command: `${build("console")}pnpm --filter @ros/console exec next start -p ${PORT}`,
          url: baseURL,
          env: { API_INTERNAL_URL: `http://localhost:${API_PORT}` },
          reuseExistingServer: !process.env.CI,
          timeout: 240_000,
        },
        {
          command: `${build("ops")}pnpm --filter @ros/ops exec next start -p ${OPS_PORT}`,
          url: opsURL,
          env: { API_INTERNAL_URL: `http://localhost:${API_PORT}` },
          reuseExistingServer: !process.env.CI,
          timeout: 240_000,
        },
      ],
});
