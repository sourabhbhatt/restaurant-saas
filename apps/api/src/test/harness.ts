/**
 * Integration test harness: a real (embedded) Postgres via PGlite with all
 * migrations applied, the real container, and helpers to call route handlers
 * exactly as Next.js would. No mocks of business logic or the database.
 */
import {
  connectPglite,
  runMigrations,
  type Executor,
} from "@ros/database/providers/postgres/client";
import { users } from "@ros/database/providers/postgres/schema";
import { buildContainer, setContainerForTests, type Container } from "@/composition/container";
import { getEnv, resetEnvCache } from "@ros/application/config/env";
import type { PaymentGateway } from "@ros/application/ports/payment-gateway";
import { eq } from "drizzle-orm";

import { migrateTo } from "@ros/testing/migrate-to";

export const TEST_ORIGIN = "http://localhost:3000";

export interface TestContainerOptions {
  /**
   * Data-migration tests: migrate up to this journal tag, run `seed` against
   * that older schema, then apply the remaining migrations before the
   * container is built.
   */
  upTo?: string;
  seed?: (db: Executor) => Promise<void>;
  /** A payment gateway (the fake) for the payments tests; default none. */
  payments?: PaymentGateway;
}

export async function createTestContainer(options: TestContainerOptions = {}): Promise<Container> {
  Object.assign(process.env, { NODE_ENV: "test" });
  process.env.DATABASE_PROVIDER = "pglite";
  process.env.ENABLE_TEST_HOOKS = "true";
  // Tests always run with the tenant role switch (row-level security) on.
  delete process.env.DATABASE_TENANT_ROLE;
  resetEnvCache();
  const handle = await connectPglite();
  if (options.upTo) {
    await migrateTo(handle, options.upTo);
    await options.seed?.(handle.db);
  }
  await runMigrations(handle, "pglite");
  const c = await buildContainer({
    env: getEnv(),
    database: handle,
    quiet: true,
    payments: options.payments ?? null,
  });
  setContainerForTests(c);
  return c;
}

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string | string[] | undefined> | undefined> },
) => Promise<Response>;

export interface CallOptions {
  method?: string;
  path?: string;
  params?: Record<string, string>;
  body?: unknown;
  cookie?: string | null;
  headers?: Record<string, string>;
  /** Simulate a cross-site request (CSRF tests). */
  origin?: string;
}

export interface CallResult<T = unknown> {
  status: number;
  body: {
    data?: T;
    error?: {
      code: string;
      message: string;
      fieldErrors?: Record<string, string[]>;
      details?: Record<string, unknown>;
    };
  };
  headers: Headers;
  setCookie: string | null;
}

export async function call<T = unknown>(
  handler: Handler,
  opts: CallOptions = {},
): Promise<CallResult<T>> {
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = opts.cookie;
  if (method !== "GET") headers.origin = opts.origin ?? TEST_ORIGIN;
  const req = new Request(`${TEST_ORIGIN}${opts.path ?? "/api/test"}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  // Mirror Next.js: static routes get params resolving to undefined.
  const res = await handler(req, { params: Promise.resolve(opts.params) });
  const text = await res.text();
  return {
    status: res.status,
    body: text ? (JSON.parse(text) as CallResult<T>["body"]) : {},
    headers: res.headers,
    setCookie: res.headers.get("set-cookie"),
  };
}

/** Extract "name=value" from a Set-Cookie header for use as a Cookie header. */
export function cookieFrom(setCookie: string | null): string {
  if (!setCookie) throw new Error("No Set-Cookie header");
  return setCookie.split(";")[0]!;
}

let counter = 0;
export function uniqueEmail(prefix = "user"): string {
  counter += 1;
  return `${prefix}.${Date.now().toString(36)}.${counter}@example.test`;
}

export async function makePlatformAdmin(c: Container, userId: string): Promise<void> {
  await c.db.update(users).set({ platformRole: "SUPER_ADMIN" }).where(eq(users.id, userId));
}
