import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, type ViteUserConfig } from "vitest/config";

const here = import.meta.dirname;

/** `server-only` throws outside React Server Components; tests import server modules directly. */
const serverOnlyStub = path.resolve(here, "../testing/src/server-only-stub.ts");

/** Fixtures give each user its own client IP through a one-entry X-Forwarded-For. */
export const SERVER_TEST_ENV = {
  NODE_ENV: "test" as const,
  APP_URL: "http://localhost:3000",
  TRUSTED_PROXY_HOPS: "1",
};

interface ProjectOptions {
  name: string;
  include: string[];
  /** Extra setup files, resolved from the package root. */
  setupFiles?: string[];
}

/** Node-environment project for domain, application, adapters, database and API tests. */
export function serverProject({ name, include, setupFiles = [] }: ProjectOptions): ViteUserConfig {
  return defineConfig({
    resolve: { tsconfigPaths: true, alias: { "server-only": serverOnlyStub } },
    test: {
      name,
      globals: true,
      environment: "node",
      include,
      setupFiles,
      env: SERVER_TEST_ENV,
      passWithNoTests: true,
      testTimeout: 30_000,
      hookTimeout: 60_000,
      coverage: { provider: "v8" },
    },
  });
}

/** jsdom project for components, features and client plumbing. */
export function uiProject({ name, include, setupFiles = [] }: ProjectOptions): ViteUserConfig {
  return defineConfig({
    plugins: [react()],
    resolve: { tsconfigPaths: true, alias: { "server-only": serverOnlyStub } },
    test: {
      name,
      globals: true,
      css: false,
      environment: "jsdom",
      include,
      setupFiles: [path.resolve(here, "vitest.setup.ts"), ...setupFiles],
      passWithNoTests: true,
      coverage: { provider: "v8" },
    },
  });
}
