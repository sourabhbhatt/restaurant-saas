import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3100);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

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
  // E2E runs against a production build so the service worker is exercised.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `pnpm build && pnpm start --port ${PORT}`,
        url: baseURL,
        // APP_URL may name another port; mutations are accepted only from listed origins.
        env: { ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS ?? new URL(baseURL).origin },
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
});
