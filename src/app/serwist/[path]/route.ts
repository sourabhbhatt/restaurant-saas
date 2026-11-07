import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

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

const serwist = createSerwistRoute({
  swSrc: "src/app/sw.ts",
  useNativeEsbuild: true,
  additionalPrecacheEntries: [{ url: "/~offline", revision: buildRevision() }],
});

// Only GET and generateStaticParams are re-exported. Serwist also returns
// `dynamic`, `dynamicParams` and `revalidate`, but those route segment options
// are rejected when `cacheComponents` is enabled. Without them the handler is
// still prerendered at build time because it reads no request-time data.
export const { GET, generateStaticParams } = serwist;
