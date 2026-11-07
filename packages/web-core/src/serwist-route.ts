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

/** The `/serwist/[path]` route of an app whose worker is `src/app/sw.ts` (paths are cwd-relative). */
export function serwistRoute() {
  return createSerwistRoute({
    swSrc: "src/app/sw.ts",
    useNativeEsbuild: true,
    additionalPrecacheEntries: [{ url: "/~offline", revision: buildRevision() }],
  });
}
