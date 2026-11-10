import "server-only";

import { z } from "zod";

import { DomainError, isDomainError } from "@ros/domain/shared/errors";
import { hashToken } from "@ros/domain/shared/tokens";
import { consentedAnalyticsIds } from "@ros/contracts/tracking-events";

import type { RequestMeta, UserActor } from "../context";
import { getContainer, type Container } from "../container";
import { clientIpFrom } from "./client-ip";
import { toErrorResponse } from "./errors";
import { readCookie, SESSION_COOKIE } from "./cookies";
import { bindUser, runWithDbContext } from "../db-context";

/**
 * Route handler wrapper used by every API endpoint. Responsibilities, in order:
 * request id → CSRF origin check (mutations) → rate limit → authentication →
 * input validation (params/query/body with zod) → idempotency replay → handler →
 * uniform JSON envelope and safe error mapping.
 *
 * Authorization is *not* done here; handlers obtain a tenant scope from the
 * access service with the validated IDs.
 */

type AuthMode = "public" | "user" | "optional" | "platform";

interface RateLimitRule {
  /** Bucket name; the client IP (and user, when signed in) is appended. */
  name: string;
  limit: number;
  windowMs: number;
}

export interface RouteConfig<
  P extends z.ZodType,
  Q extends z.ZodType,
  B extends z.ZodType,
  A extends AuthMode,
> {
  auth: A;
  params?: P;
  query?: Q;
  body?: B;
  rateLimit?: RateLimitRule;
  /**
   * Enable Idempotency-Key replay. The scope string should include the tenant
   * (e.g. `payment:${branchId}`); the stored response is returned for repeats.
   */
  idempotency?: (input: { params: z.infer<P> }) => string;
  /** Allow cross-origin POST (e.g. cron with bearer secret). Default false. */
  skipOriginCheck?: boolean;
  /** Accept mutations in maintenance mode (sign-in/out). Platform and job routes always do. */
  allowInMaintenance?: boolean;
}

export interface HandlerInput<
  P extends z.ZodType,
  Q extends z.ZodType,
  B extends z.ZodType,
  A extends AuthMode,
> {
  req: Request;
  params: z.infer<P>;
  query: z.infer<Q>;
  body: z.infer<B>;
  actor: A extends "user" | "platform" ? UserActor : UserActor | null;
  meta: RequestMeta;
  c: Container;
}

export type HandlerResult =
  { status?: number; data: unknown; headers?: Record<string, string> } | Response;

type RouteContext = { params?: Promise<Record<string, string | string[] | undefined> | undefined> };

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function json(
  status: number,
  body: unknown,
  requestId: string,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": requestId,
      ...headers,
    },
  });
}

export function requestIdFrom(req: Request): string {
  return req.headers.get("x-request-id")?.slice(0, 64) || crypto.randomUUID();
}

/** Same-origin check for cookie-authenticated mutations (CSRF defence with SameSite=Lax cookies). */
function assertSameOrigin(req: Request, allowed: string[]): void {
  const site = req.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "none") return;
  const origin = req.headers.get("origin");
  if (!origin) {
    // Non-browser clients without Origin and without cookies are fine; with a cookie we require it.
    if (!req.headers.get("cookie")) return;
    throw new DomainError("FORBIDDEN", "Cross-site request blocked");
  }
  // Not the request URL's own origin: behind a proxy that is derived from the client-supplied Host.
  if (!allowed.includes(origin)) throw new DomainError("FORBIDDEN", "Cross-site request blocked");
}

const MAINTENANCE_CACHE_MS = 10_000;
const maintenanceCache = new WeakMap<Container, { at: number; on: boolean }>();

/** Read at most every 10 s per process; other instances pick up a change within that window. */
async function inMaintenance(c: Container): Promise<boolean> {
  const now = c.clock.now().getTime();
  const hit = maintenanceCache.get(c);
  if (hit && now >= hit.at && now - hit.at < MAINTENANCE_CACHE_MS) return hit.on;
  const on = (await c.entitlements.getPlatformSettings()).maintenanceMode;
  maintenanceCache.set(c, { at: now, on });
  return on;
}

/** Drop the cached flag after this process changes platform settings, so the change applies at once. */
export function forgetMaintenanceFlag(c: Container): void {
  maintenanceCache.delete(c);
}

export async function resolveActor(req: Request, c: Container): Promise<UserActor | null> {
  const token = readCookie(req.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const session = await c.identity.resolveSession(token);
  if (!session) return null;
  const user = await c.repos.identity.findUserById(session.userId);
  if (!user || user.disabledAt) return null;
  return {
    type: "user",
    userId: user.id,
    sessionId: session.sessionId,
    email: user.email,
    name: user.name,
    isPlatformAdmin: user.platformRole === "SUPER_ADMIN",
    emailVerified: user.emailVerifiedAt !== null,
    activeWorkspaceId: session.activeWorkspaceId,
  };
}

async function parseBody(req: Request): Promise<unknown> {
  const type = req.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) {
    throw new DomainError("BAD_REQUEST", "Expected a JSON request body");
  }
  const text = await req.text();
  if (text.length > 1_000_000) throw new DomainError("BAD_REQUEST", "Request body too large");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new DomainError("BAD_REQUEST", "Malformed JSON body");
  }
}

function queryObject(url: URL): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const key of new Set(url.searchParams.keys())) {
    const all = url.searchParams.getAll(key);
    out[key] = all.length > 1 ? all : all[0]!;
  }
  return out;
}

const empty = z.object({}).passthrough();

export function route<
  P extends z.ZodType = typeof empty,
  Q extends z.ZodType = typeof empty,
  B extends z.ZodType = typeof empty,
  A extends AuthMode = AuthMode,
>(
  config: RouteConfig<P, Q, B, A>,
  handler: (input: HandlerInput<P, Q, B, A>) => Promise<HandlerResult>,
): (req: Request, ctx: RouteContext) => Promise<Response> {
  return async (req, ctx) => {
    const requestId = requestIdFrom(req);
    let c: Container | null = null;
    try {
      c = await getContainer();
      const container = c;
      return await runWithDbContext(() => serve(container));
    } catch (error) {
      return failure(error, c);
    }

    async function serve(c: Container): Promise<Response> {
      const meta: RequestMeta = {
        requestId,
        ip: clientIpFrom(req.headers, c.env.TRUSTED_PROXY_HOPS),
        userAgent: req.headers.get("user-agent"),
        // Read (and, for a checkout, stored) only while server tracking is on.
        analytics:
          c.tracking.provider === "none"
            ? null
            : consentedAnalyticsIds(req.headers.get("cookie"), c.env.GA_MEASUREMENT_ID),
      };
      if (MUTATING.has(req.method) && !config.skipOriginCheck)
        assertSameOrigin(req, c.env.ALLOWED_ORIGINS);
      if (
        MUTATING.has(req.method) &&
        config.auth !== "platform" &&
        !config.skipOriginCheck &&
        !config.allowInMaintenance &&
        (await inMaintenance(c))
      ) {
        throw new DomainError(
          "MAINTENANCE",
          "We're down for scheduled maintenance. Please try again shortly.",
        );
      }

      const actor = config.auth === "public" ? null : await resolveActor(req, c);
      if (actor) bindUser(actor.userId);
      if ((config.auth === "user" || config.auth === "platform") && !actor) {
        throw new DomainError("UNAUTHENTICATED", "Please sign in to continue");
      }
      if (config.auth === "platform") c.access.requirePlatformAdmin(actor!);

      if (config.rateLimit) {
        const r = config.rateLimit;
        const key = `${r.name}:${meta.ip ?? "unknown"}${actor ? `:${actor.userId}` : ""}`;
        const hit = await c.repos.rateLimit.hit(key, r.windowMs, c.clock.now());
        if (hit.count > r.limit) {
          throw new DomainError(
            "RATE_LIMITED",
            "Too many attempts. Please wait a moment and try again.",
            {
              details: {
                retryAfterSeconds: Math.ceil((hit.resetAt.getTime() - Date.now()) / 1000),
              },
            },
          );
        }
      }

      // Static routes receive no params (ctx.params resolves to undefined in Next 16).
      const params = (config.params ?? empty).parse((await ctx?.params) ?? {}) as z.infer<P>;
      const query = (config.query ?? empty).parse(queryObject(new URL(req.url))) as z.infer<Q>;
      const rawBody = MUTATING.has(req.method) && config.body ? await parseBody(req) : {};
      const body = (config.body ?? empty).parse(rawBody) as z.infer<B>;

      let idem: { scope: string; key: string; hash: string } | null = null;
      if (config.idempotency) {
        const key = req.headers.get("idempotency-key");
        if (key) {
          if (!/^[A-Za-z0-9_-]{8,100}$/.test(key))
            throw new DomainError("BAD_REQUEST", "Invalid Idempotency-Key");
          // Bound to the caller so one user's key can't replay another tenant's stored response.
          const scope = `${config.idempotency({ params })}:${actor ? `u:${actor.userId}` : "anon"}`;
          const hash = await hashToken(JSON.stringify(rawBody));
          const existing = await c.repos.idempotency.find(scope, key);
          if (existing) {
            if (existing.requestHash !== hash) {
              throw new DomainError(
                "IDEMPOTENCY_MISMATCH",
                "This request key was already used for a different request",
              );
            }
            return json(existing.statusCode, existing.response, requestId, {
              "idempotent-replay": "true",
            });
          }
          idem = { scope, key, hash };
        }
      }

      const result = await handler({
        req,
        params,
        query,
        body,
        actor: actor as HandlerInput<P, Q, B, A>["actor"],
        meta,
        c,
      });
      if (result instanceof Response) return result;
      const status = result.status ?? 200;
      const payload = { data: result.data };
      if (idem && status < 500)
        await c.repos.idempotency.save(idem.scope, idem.key, idem.hash, status, payload);
      return json(status, payload, requestId, result.headers);
    }

    function failure(error: unknown, c: Container | null): Response {
      const { status, body } = toErrorResponse(error, requestId);
      // Expected errors (maintenance) are not incidents.
      if (status >= 500 && !isDomainError(error)) {
        c?.errors.capture(error, {
          requestId,
          path: new URL(req.url).pathname,
          method: req.method,
        });
        if (!c)
          console.error(
            JSON.stringify({
              level: "error",
              msg: "container_unavailable",
              requestId,
              error: String(error),
            }),
          );
      }
      const headers: Record<string, string> = {};
      const retry = body.error.details?.retryAfterSeconds;
      if (status === 429 && typeof retry === "number")
        headers["retry-after"] = String(Math.max(retry, 1));
      return json(status, body, requestId, headers);
    }
  };
}

export const uuidParam = z.uuid({ message: "Invalid id" });
