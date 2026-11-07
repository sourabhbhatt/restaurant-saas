import path from "node:path";

import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const alias = {
  // `server-only` throws outside React Server Components; tests import server modules directly.
  "server-only": path.resolve(import.meta.dirname, "src/test/server-only-stub.ts"),
};

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true, alias },
  test: {
    globals: true,
    css: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/app/**/layout.tsx", "src/test/**"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "ui",
          environment: "jsdom",
          setupFiles: ["./packages/tooling/vitest.setup.ts"],
          include: ["src/{components,features,lib,app}/**/*.test.{ts,tsx}"],
        },
      },
      {
        extends: true,
        test: {
          name: "server",
          environment: "node",
          include: [
            "src/{domain,server,infrastructure,contracts}/**/*.test.ts",
            "tests/integration/**/*.test.ts",
          ],
          // Fixtures give each user its own client IP through a one-entry X-Forwarded-For.
          env: { NODE_ENV: "test", APP_URL: "http://localhost:3000", TRUSTED_PROXY_HOPS: "1" },
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
