import path from "node:path";

import type { NextConfig } from "next";
import { withSerwist } from "@serwist/turbopack";
import { SECURITY_HEADERS } from "@ros/web-core/security-headers";
import { HTML_LIMITED_BOTS } from "@ros/web-core/features/site/seo/crawlers";
import { NOINDEX } from "@ros/web-core/features/site/seo/robots-policy";

const repoRoot = path.resolve(import.meta.dirname, "../..");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  cacheComponents: true,
  partialPrefetching: true,
  // Search and AI crawlers get metadata (canonical, robots) in the initial <head>.
  htmlLimitedBots: HTML_LIMITED_BOTS,
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
        // API responses are never search results. Pages get X-Robots-Tag from src/proxy.ts.
        source: "/api/:path*",
        headers: [{ key: "X-Robots-Tag", value: NOINDEX }],
      },
    ];
  },
};

export default withSerwist(nextConfig);
