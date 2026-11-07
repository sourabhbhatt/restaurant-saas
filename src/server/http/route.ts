import "server-only";

import { z } from "zod";

import { DomainError } from "@/domain/shared/errors";
import { hashToken } from "@/domain/shared/tokens";

import type { RequestMeta, UserActor } from "../context";
import { getContainer, type Container } from "../container";
import { clientIpFrom } from "./client-ip";
import { toErrorResponse } from "./errors";
import { readCookie, SESSION_COOKIE } from "./cookies";

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

function json(
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

/** Same-origin check for cookie-authenticated mutations (CSRF defence with SameSite=Lax cookies). */
function assertSameOrigin(req: Request, appUrl: string): void {
  const site = req.headers.get("sec-fetch-site");
  if (site === "same-origin" || site === "none") return;
  const origin = req.headers.get("origin");
  if (!origin) {
    // Non-browser clients without Origin and without cookies are fine; with a cookie we require it.
    if (!req.headers.get("cookie")) return;
    throw new DomainError("FORBIDDEN", "Cross-site request blocked");
  }
  const allowed = new Set([new URL(appUrl).origin, new URL(req.url).origin]);
  if (!allowed.has(origin)) throw new DomainError("FORBIDDEN", "Cross-site request blocked");
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
    const requestId = req.headers.get("x-request-id")?.slice(0, 64) || crypto.randomUUID();
    let c: Container | null = null;
    try {
      c = await getContainer();
      const meta: RequestMeta = {
        requestId,
        ip: clientIpFrom(req.headers, c.env.TRUSTED_PROXY_HOPS),
        userAgent: req.headers.get("user-agent"),
      };
      if (MUTATING.has(req.method) && !config.skipOriginCheck) assertSameOrigin(req, c.env.APP_URL);

      const actor = config.auth === "public" ? null : await resolveActor(req, c);
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
          const scope = config.idempotency({ params });
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
    } catch (error) {
      const { status, body } = toErrorResponse(error, requestId);
      if (status >= 500) {
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

/** Shared param schemas. */
export const uuidParam = z.uuid({ message: "Invalid id" });
