import { defineConfig } from "vitest/config";

/**
 * Workspace runner for ad-hoc `pnpm exec vitest run <file>` from the root.
 * `pnpm test` goes through Turborepo so each app and package runs its own config.
 */
export default defineConfig({
  test: {
    projects: ["apps/*/vitest.config.mts", "packages/*/vitest.config.mts"],
  },
});
