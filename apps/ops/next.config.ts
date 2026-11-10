import path from "node:path";

import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";
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
        // The service worker must never be cached by the browser or a CDN,
        // otherwise clients keep running an outdated worker.
        source: "/serwist/:path*",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
      {
        // Staff consoles are never search results.
        source: "/:path*",
        headers: [{ key: "X-Robots-Tag", value: NOINDEX }],
      },
    ];
  },
};

export default withSerwist(nextConfig);
