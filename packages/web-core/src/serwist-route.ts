import { randomUUID } from "node:crypto";
import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
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

/** Where `pnpm build` writes the bundled worker (scripts/prebuild-sw.mjs), relative to the app. */
export const PREBUILT_SW_DIR = path.join(".next", "sw-prebuilt");
const PREBUILT = new Set(["sw.js", "sw.js.map"]);

/** Serwist's own route for an app whose worker is `src/app/sw.ts` (paths are cwd-relative). */
export function serwistBuilder() {
  return createSerwistRoute({
    swSrc: "src/app/sw.ts",
    useNativeEsbuild: true,
    additionalPrecacheEntries: [{ url: "/~offline", revision: buildRevision() }],
  });
}

type Ctx = { params: Promise<{ path: string }> };

/**
 * The `/serwist/[path]` route. Serves the worker bundled at build time;
 * Serwist's runtime bundling (needs esbuild and the sources) is only the
 * fallback, because Next.js cannot be forced to prerender this route under
 * `cacheComponents` and the standalone images do not ship esbuild.
 */
export function serwistRoute() {
  const builder = serwistBuilder();
  const GET = async (req: Request, ctx: Ctx): Promise<Response> => {
    const { path: file } = await ctx.params;
    if (PREBUILT.has(file)) {
      try {
        const body = await readFile(path.join(process.cwd(), PREBUILT_SW_DIR, file));
        return new Response(body, {
          headers: {
            // The worker lives under /serwist/ but controls the whole origin.
            "service-worker-allowed": "/",
            "content-type": file.endsWith(".map")
              ? "application/json; charset=utf-8"
              : "application/javascript; charset=utf-8",
          },
        });
      } catch {
        // Not prebuilt (e.g. `next dev`): let Serwist bundle it.
      }
    }
    return builder.GET(req as never, ctx as never);
  };
  return { GET, generateStaticParams: builder.generateStaticParams };
}
