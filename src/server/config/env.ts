import "server-only";

import { z } from "zod";

/**
 * Server environment configuration, validated once at startup. Every
 * provider is chosen here by an env var, so swapping a provider is a config
 * change plus an adapter (see docs/provider-migration-guide.md).
 */
const booleanish = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  APP_NAME: z.string().min(1).default("RestaurantOS"),

  DATABASE_PROVIDER: z.enum(["postgres", "pglite"]).default("postgres"),
  DATABASE_URL: z
    .string()
    .default("postgres://restaurantos:restaurantos@localhost:5432/restaurantos_dev"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /** PGlite data dir; empty = in-memory. */
  PGLITE_DATA_DIR: z.string().optional(),

  /** 32+ char secret used to derive encryption keys (QR token encryption). */
  APP_SECRET: z.string().min(32).default("dev-only-insecure-secret-change-me-0123456789"),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  COOKIE_SECURE: booleanish.optional(),

  EMAIL_PROVIDER: z.enum(["outbox", "resend", "brevo"]).default("outbox"),
  EMAIL_FROM: z.string().default("RestaurantOS <no-reply@restaurantos.local>"),
  RESEND_API_KEY: z.string().optional(),
  BREVO_API_KEY: z.string().optional(),

  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".data/uploads"),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanish.default(false),

  REALTIME_PROVIDER: z.enum(["memory", "none"]).default("memory"),

  PUSH_PROVIDER: z.enum(["none", "webpush"]).default("none"),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  ERROR_REPORTER: z.enum(["log", "none"]).default("log"),

  /** Shared secret for scheduled job endpoints (Authorization: Bearer ...). */
  CRON_SECRET: z.string().min(16).optional(),
  /** Enables the test clock endpoint and dev mailbox. Never enable in production. */
  ENABLE_TEST_HOOKS: booleanish.default(false),
});

export type ServerEnv = z.infer<typeof schema>;

let cached: ServerEnv | null = null;

export function getEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server environment: ${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production") {
    if (env.APP_SECRET.startsWith("dev-only"))
      throw new Error("APP_SECRET must be set in production");
    // The schema default (0) would hide a forgotten setting, so check the raw value.
    if (!process.env.TRUSTED_PROXY_HOPS)
      throw new Error("TRUSTED_PROXY_HOPS must be set in production");
    if (env.ENABLE_TEST_HOOKS) throw new Error("ENABLE_TEST_HOOKS must be false in production");
  }
  cached = env;
  return env;
}

/** Test helper: reset cached env after mutating process.env. */
export function resetEnvCache(): void {
  cached = null;
}

export function cookieSecure(env: ServerEnv = getEnv()): boolean {
  return env.COOKIE_SECURE ?? env.APP_URL.startsWith("https://");
}
