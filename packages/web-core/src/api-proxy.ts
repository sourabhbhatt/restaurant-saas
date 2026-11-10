/**
 * Runtime reverse proxy for `/api/v1/*`: each frontend forwards API calls to
 * the API service so the session cookie stays first-party on every origin.
 * It is a route handler, not a `rewrites()` entry, because rewrites are
 * serialised at build time and the API URL must come from the runtime
 * environment.
 */

/** Request headers copied to the upstream call. Everything else is dropped. */
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "cookie",
  "content-type",
  "idempotency-key",
  "origin",
  "sec-fetch-site",
  "user-agent",
  "x-request-id",
  "x-forwarded-for",
  "x-forwarded-proto",
] as const;

/** Hop-by-hop headers never relayed from the upstream response. */
const DROPPED_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
  "content-length",
  "set-cookie",
]);

export interface ApiProxyConfig {
  /** Read at request time, never at build time. */
  apiInternalUrl: () => string;
  /** Whether /api/v1/test/* and /api/v1/dev/* may pass through (default: never). */
  allowTestHooks?: () => boolean;
  /** Overridable for tests. */
  fetch?: typeof fetch;
}

/** Internal hook routes are relayed only when the frontend opts in explicitly. */
const TEST_HOOK_PATH = /^\/api\/v1\/(test|dev)(\/|$)/;
const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Not found" } };

type Handler = (req: Request, ctx: { params: Promise<{ path: string[] }> }) => Promise<Response>;

export interface ApiProxy {
  GET: Handler;
  POST: Handler;
  PUT: Handler;
  PATCH: Handler;
  DELETE: Handler;
}

const UNAVAILABLE = { error: { code: "INTERNAL_ERROR", message: "API unavailable" } };

function upstreamUrl(base: string, req: Request): URL {
  const incoming = new URL(req.url);
  const url = new URL(base);
  // Keep the full /api/v1/... path; only the origin changes.
  url.pathname = `${url.pathname.replace(/\/$/, "")}${incoming.pathname}`;
  url.search = incoming.search;
  return url;
}

function upstreamHeaders(req: Request): Headers {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const incoming = new URL(req.url);
  headers.set("x-forwarded-host", req.headers.get("host") ?? incoming.host);
  if (!headers.has("x-forwarded-proto"))
    headers.set("x-forwarded-proto", incoming.protocol.replace(":", ""));
  return headers;
}

function relayedHeaders(upstream: Response): Headers {
  const headers = new Headers();
  upstream.headers.forEach((value, name) => {
    if (!DROPPED_RESPONSE_HEADERS.has(name.toLowerCase())) headers.set(name, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) headers.append("set-cookie", cookie);
  if (upstream.headers.get("content-type")?.includes("text/event-stream")) {
    // Tell nginx-style proxies in front of the frontend not to buffer the stream.
    headers.set("x-accel-buffering", "no");
    headers.set("cache-control", "no-cache, no-transform");
  }
  return headers;
}

export function createApiProxy(config: ApiProxyConfig): ApiProxy {
  const doFetch = config.fetch ?? fetch;

  const handler: Handler = async (req) => {
    if (TEST_HOOK_PATH.test(new URL(req.url).pathname) && !config.allowTestHooks?.())
      return Response.json(NOT_FOUND, { status: 404 });
    const base = config.apiInternalUrl();
    const hasBody = req.method !== "GET" && req.method !== "HEAD" && req.body !== null;
    let upstream: Response;
    try {
      upstream = await doFetch(upstreamUrl(base, req), {
        method: req.method,
        headers: upstreamHeaders(req),
        body: hasBody ? req.body : undefined,
        // Required by undici when streaming a request body.
        ...(hasBody ? { duplex: "half" as const } : {}),
        redirect: "manual",
        signal: req.signal,
        // Never let the fetch cache or Next's data cache touch API traffic.
        cache: "no-store",
      });
    } catch {
      return Response.json(UNAVAILABLE, { status: 502 });
    }
    // The body is passed through as a stream, so SSE and large downloads are never buffered.
    return new Response(upstream.body, {
      status: upstream.status,
      headers: relayedHeaders(upstream),
    });
  };

  return { GET: handler, POST: handler, PUT: handler, PATCH: handler, DELETE: handler };
}

/** Default API origin for local development (apps/api runs on 4000). */
export const DEFAULT_API_INTERNAL_URL = "http://localhost:4000";

/**
 * Proxy bound to `API_INTERNAL_URL`, re-exported by each frontend's
 * `app/api/v1/[...path]/route.ts`.
 */
export const apiProxy = createApiProxy({
  apiInternalUrl: () => process.env.API_INTERNAL_URL || DEFAULT_API_INTERNAL_URL,
  allowTestHooks: () => /^(1|true|yes)$/i.test(process.env.ENABLE_TEST_HOOKS ?? ""),
});
