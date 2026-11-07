import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";
import type { Plugin } from "esbuild";

/** Revision for precached non-hashed URLs; changes on every commit/build. */
function buildRevision(): string {
  try {
    return execSync("git rev-parse HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return randomUUID();
  }
}

/**
 * pnpm installs `serwist` twice (same version, different browserslist peers):
 * once for sw.ts and once for @serwist/turbopack's `defaultCache`. With two
 * copies Serwist's `handler instanceof Strategy` check is false for the
 * defaultCache routes, so the `/~offline` fallback was never attached to the
 * route that serves page navigations and offline navigations failed with
 * ERR_FAILED. Every `serwist` import is resolved from the app root instead.
 */
const singleSerwist: Plugin = {
  name: "single-serwist",
  setup(build) {
    build.onResolve({ filter: /^serwist$/ }, async (args) => {
      if (args.pluginData === "single-serwist") return undefined;
      const resolved = await build.resolve("serwist", {
        kind: args.kind,
        resolveDir: process.cwd(),
        pluginData: "single-serwist",
      });
      return resolved.errors.length > 0 ? { errors: resolved.errors } : { path: resolved.path };
    });
  },
};

const serwist = createSerwistRoute({
  swSrc: "src/app/sw.ts",
  useNativeEsbuild: true,
  esbuildOptions: { plugins: [singleSerwist] },
  additionalPrecacheEntries: [{ url: "/~offline", revision: buildRevision() }],
});

// Only GET and generateStaticParams are re-exported. Serwist also returns
// `dynamic`, `dynamicParams` and `revalidate`, but those route segment options
// are rejected when `cacheComponents` is enabled. Without them the handler is
// still prerendered at build time because it reads no request-time data.
export const { GET, generateStaticParams } = serwist;
