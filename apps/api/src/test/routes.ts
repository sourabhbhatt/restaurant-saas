/**
 * Route discovery for the security suites: every `route.ts` under
 * `src/app/api/v1`, keyed by its path below `v1` (e.g. `branches/[branchId]`),
 * with the HTTP methods it exports. Suites use it to prove coverage, so a new
 * route without a test case fails the build instead of going unnoticed.
 */
import { readdirSync } from "node:fs";
import path from "node:path";

import { TEST_ORIGIN } from "./harness";

export const API_DIR = path.resolve(import.meta.dirname, "../app/api/v1");

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string | string[] | undefined> | undefined> },
) => Promise<Response>;

export interface RouteModule {
  route: string;
  methods: Partial<Record<HttpMethod, Handler>>;
}

/** Route keys (`a/[b]/c`) of every route file, sorted. */
export function listRouteKeys(): string[] {
  return readdirSync(API_DIR, { recursive: true, encoding: "utf8" })
    .filter((f) => f === "route.ts" || f.endsWith(`${path.sep}route.ts`))
    .map((f) => path.dirname(f).split(path.sep).join("/"))
    .sort();
}

/** Import every route module under `src/app/api/v1`. */
export async function loadRoutes(): Promise<Map<string, RouteModule>> {
  const out = new Map<string, RouteModule>();
  for (const route of listRouteKeys()) {
    const mod = (await import(path.join(API_DIR, route, "route.ts"))) as Record<string, unknown>;
    const methods: RouteModule["methods"] = {};
    for (const m of HTTP_METHODS) {
      if (typeof mod[m] === "function") methods[m] = mod[m] as Handler;
    }
    out.set(route, { route, methods });
  }
  return out;
}

export const isDynamic = (route: string) => route.includes("[");

/** Fill `[param]` / `[...param]` segments for a request URL. */
export function routePath(route: string, params: Record<string, string>): string {
  const filled = route.replace(/\[(?:\.\.\.)?(\w+)\]/g, (_, name: string) => params[name] ?? name);
  return `/api/v1/${filled}`;
}

/**
 * Call a Server-Sent Events handler and return only its status; a stream is
 * cancelled and the request aborted so the test never waits on it.
 */
export async function callStream(
  handler: Handler,
  opts: { params: Record<string, string>; cookie: string; path: string },
): Promise<{ status: number; body: { error?: { code: string } }; contentType: string | null }> {
  const abort = new AbortController();
  const req = new Request(`${TEST_ORIGIN}${opts.path}`, {
    headers: { cookie: opts.cookie },
    signal: abort.signal,
  });
  const res = await handler(req, { params: Promise.resolve(opts.params) });
  const contentType = res.headers.get("content-type");
  if (contentType?.includes("text/event-stream")) {
    abort.abort();
    await res.body?.cancel().catch(() => {});
    return { status: res.status, body: {}, contentType };
  }
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {}, contentType };
}
