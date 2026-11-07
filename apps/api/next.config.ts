import path from "node:path";

import type { NextConfig } from "next";

const repoRoot = path.resolve(import.meta.dirname, "../..");

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
