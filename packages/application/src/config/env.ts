import "server-only";

import { z } from "zod";

/**
 * Server environment configuration, validated once at startup. Every
 * provider is chosen here by an env var, so swapping a provider is a config
 * change plus an adapter (see docs/provider-migration-guide.md).
 */
const booleanish = z.enum(["true", "false", "1", "0"]).transform((v) => v === "true" || v === "1");

/** Comma-separated origins, normalised with `new URL(x).origin`; blank means "use the default". */
const originList = z
  .string()
  .optional()
  .transform((raw, ctx) => {
    const parts = (raw ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return undefined;
    const origins: string[] = [];
    for (const part of parts) {
      const url = URL.canParse(part) ? new URL(part) : null;
      // Wildcards are not patterns here; WHATWG URL would accept "*" as a literal host character.
      if (!url || !["http:", "https:"].includes(url.protocol) || url.host.includes("*")) {
        ctx.addIssue({
          code: "custom",
          message: `Invalid origin "${part}" (http(s), no wildcards)`,
        });
        return z.NEVER;
      }
      origins.push(url.origin);
    }
    return [...new Set(origins)];
  });

const fields = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url().default("http://localhost:3000"),
  /** Origins allowed to send cookie-authenticated mutations. Default: APP_URL's origin. */
  ALLOWED_ORIGINS: originList,
  /** Base of the links printed on table QR codes. Default: APP_URL. */
  QR_BASE_URL: z.url().optional(),
  APP_NAME: z.string().min(1).default("RestaurantOS"),
  /** Build or release identifier reported by /api/v1/health. */
  APP_VERSION: z.string().min(1).optional(),

  DATABASE_PROVIDER: z.enum(["postgres", "pglite"]).default("postgres"),
  DATABASE_URL: z
    .string()
    .default("postgres://restaurantos:restaurantos@localhost:5432/restaurantos_dev"),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /**
   * Role tenant transactions switch into so row-level security applies.
   * `none` disables the switch: emergency rollback only, logged at startup.
   */
  DATABASE_TENANT_ROLE: z
    .string()
    .regex(/^[a-z_][a-z0-9_]*$/)
    .default("ros_tenant"),
  /** PGlite data dir; empty = in-memory. */
  PGLITE_DATA_DIR: z.string().optional(),

  /** 32+ char secret used to derive encryption keys (QR token encryption). */
  APP_SECRET: z.string().min(32).default("dev-only-insecure-secret-change-me-0123456789"),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /**
   * Shared with the frontends' /api/v1 proxies, which sign the browser's IP
   * with it (`x-ros-client-ip`). Unset: only X-Forwarded-For is used.
   */
  PROXY_SHARED_SECRET: z.string().min(16).optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  COOKIE_SECURE: booleanish.optional(),

  EMAIL_PROVIDER: z.enum(["outbox", "resend", "brevo"]).default("outbox"),
  EMAIL_FROM: z.string().default("RestaurantOS <no-reply@restaurantos.local>"),
  RESEND_API_KEY: z.string().optional(),
  BREVO_API_KEY: z.string().optional(),

  STORAGE_PROVIDER: z.enum(["local", "s3", "gcs"]).default("local"),
  /** Bucket for STORAGE_PROVIDER=gcs (keyless: the runtime's service account). */
  GCS_BUCKET: z.string().optional(),
  STORAGE_LOCAL_DIR: z.string().default(".data/uploads"),
  S3_ENDPOINT: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: booleanish.default(false),

  REALTIME_PROVIDER: z.enum(["memory", "postgres", "none"]).default("memory"),

  PUSH_PROVIDER: z.enum(["none", "webpush"]).default("none"),
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().optional(),

  /** `none` keeps the manual upgrade-request flow only; `razorpay` adds online checkout. */
  PAYMENT_PROVIDER: z.enum(["none", "razorpay"]).default("none"),
  /** The only Razorpay value ever sent to the browser. Must be a test-mode key (`rzp_test_...`). */
  RAZORPAY_KEY_ID: z.string().min(1).optional(),
  RAZORPAY_KEY_SECRET: z.string().min(1).optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().min(1).optional(),

  /** Server-side growth events: `none` sends nothing; `ga4` uses the GA4 Measurement Protocol. */
  TRACKING_PROVIDER: z.enum(["none", "ga4"]).default("none"),
  /** This environment's GA4 web stream (the console's), so server events join browser data. */
  GA_MEASUREMENT_ID: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z
      .string()
      .regex(/^G-[A-Z0-9]{4,20}$/, "Expected a GA4 Measurement ID (G-XXXXXXX)")
      .optional(),
  ),
  /** Measurement Protocol API secret of that stream; with `ga4` both are required. */
  GA_API_SECRET: z.preprocess((v) => (v === "" ? undefined : v), z.string().min(1).optional()),

  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  ERROR_REPORTER: z.enum(["log", "none"]).default("log"),

  /** Shared secret for scheduled job endpoints (Authorization: Bearer ...). */
  CRON_SECRET: z.string().min(16).optional(),
  /** Enables the test clock endpoint and dev mailbox. Never enable in production. */
  ENABLE_TEST_HOOKS: booleanish.default(false),
});

const schema = fields.transform((env) => ({
  ...env,
  ALLOWED_ORIGINS: env.ALLOWED_ORIGINS ?? [new URL(env.APP_URL).origin],
  QR_BASE_URL: env.QR_BASE_URL ?? env.APP_URL,
}));

export type ServerEnv = z.output<typeof schema>;

let cached: ServerEnv | null = null;

export function getEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid server environment: ${issues}`);
  }
  const env = parsed.data;
  if (env.PAYMENT_PROVIDER === "razorpay") {
    const missing = (
      ["RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"] as const
    ).filter((key) => !env[key]);
    if (missing.length) throw new Error(`PAYMENT_PROVIDER=razorpay requires ${missing.join(", ")}`);
    // Owner's rule: this deployment never takes live payments. There is no override flag.
    if (!env.RAZORPAY_KEY_ID!.startsWith("rzp_test_")) {
      throw new Error("Live Razorpay keys are not allowed: use a rzp_test_ key (test mode only)");
    }
  }
  if (env.TRACKING_PROVIDER === "ga4" && (!env.GA_MEASUREMENT_ID || !env.GA_API_SECRET))
    throw new Error("TRACKING_PROVIDER=ga4 requires GA_MEASUREMENT_ID and GA_API_SECRET");
  if (env.NODE_ENV === "production") {
    if (env.APP_SECRET.startsWith("dev-only"))
      throw new Error("APP_SECRET must be set in production");
    // The schema default (0) would hide a forgotten setting, so check the raw value.
    if (!process.env.TRUSTED_PROXY_HOPS)
      throw new Error("TRUSTED_PROXY_HOPS must be set in production");
    // The compose example ships a placeholder that passes the length check.
    if (env.PROXY_SHARED_SECRET?.startsWith("replace-with"))
      throw new Error("PROXY_SHARED_SECRET must be set to a random value in production");
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

/** False when ALLOWED_ORIGINS was set without APP_URL's own origin (logged once at startup). */
export function appOriginAllowed(env: ServerEnv): boolean {
  return env.ALLOWED_ORIGINS.includes(new URL(env.APP_URL).origin);
}

/** The tenant runner's role, or null when disabled with `DATABASE_TENANT_ROLE=none`. */
export function tenantRole(env: ServerEnv): string | null {
  return env.DATABASE_TENANT_ROLE === "none" ? null : env.DATABASE_TENANT_ROLE;
}
