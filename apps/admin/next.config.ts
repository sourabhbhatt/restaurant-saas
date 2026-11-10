import path from "node:path";

import type { NextConfig } from "next";

import { SECURITY_HEADERS } from "@ros/web-core/security-headers";
import { NOINDEX } from "@ros/web-core/features/site/seo/robots-policy";

const repoRoot = path.resolve(import.meta.dirname, "../..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  output: "standalone",
  // Trace from the monorepo root so workspace packages land in .next/standalone.
  outputFileTracingRoot: repoRoot,
  turbopack: {
    root: repoRoot,
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  transpilePackages: [
    "@ros/domain",
    "@ros/contracts",
    "@ros/api-client",
    "@ros/ui",
    "@ros/web-core",
  ],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        // The admin app is never a search result.
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: NOINDEX }],
      },
    ];
  },
};

export default nextConfig;
