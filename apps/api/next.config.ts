import path from "node:path";

import type { NextConfig } from "next";

const repoRoot = path.resolve(import.meta.dirname, "../..");

// Local development reads the repo-root .env.local (the db:* scripts use the
// same file) and anchors relative data directories there, not under apps/api.
// Containers set their environment directly, so a missing file is fine.
// ROS_NO_ENV_FILE=1 (the E2E API) runs with exactly the environment it was given.
try {
  if (process.env.ROS_NO_ENV_FILE !== "1") process.loadEnvFile(path.join(repoRoot, ".env.local"));
} catch {
  // no .env.local
}
for (const key of ["PGLITE_DATA_DIR", "STORAGE_LOCAL_DIR"] as const) {
  const value = process.env[key];
  if (value && !value.startsWith("memory:") && !path.isAbsolute(value))
    process.env[key] = path.resolve(repoRoot, value);
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  output: "standalone",
  // Trace from the monorepo root so workspace packages land in .next/standalone.
  outputFileTracingRoot: repoRoot,
  outputFileTracingIncludes: {
    // /api/v1/health/ready reads the migration journal from MIGRATIONS_DIR.
    "/*": ["../../packages/database/src/providers/postgres/migrations/**/*"],
  },
  turbopack: { root: repoRoot },
  transpilePackages: [
    "@ros/domain",
    "@ros/contracts",
    "@ros/application",
    "@ros/adapters",
    "@ros/database",
  ],
};

export default nextConfig;
