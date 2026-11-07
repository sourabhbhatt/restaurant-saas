import "server-only";

import { sql } from "drizzle-orm";

import { createLocalIdentityProvider } from "@ros/adapters/auth/providers/local-identity";
import {
  connectPglite,
  connectPostgres,
  runMigrations,
  type DatabaseHandle,
} from "@ros/database/providers/postgres/client";
import {
  accessRepository,
  auditRepository,
  emailOutboxRepository,
  entitlementRepository,
  idempotencyRepository,
  identityRepository,
  rateLimitRepository,
} from "@ros/database/providers/postgres/repositories/core";
import { pendingMigrations } from "@ros/database/providers/postgres/row-counts";
import { isPersistentPgliteDir } from "@ros/database/providers/postgres/snapshot";
import { ensureSystemData } from "@ros/database/providers/postgres/system-data";
import type { EmailSender } from "@ros/adapters/email/interfaces/email-sender";
import {
  createBrevoEmailSender,
  createResendEmailSender,
} from "@ros/adapters/email/providers/http-senders";
import { createOutboxEmailSender } from "@ros/adapters/email/providers/outbox-sender";
import {
  createConsoleLogger,
  createLogErrorReporter,
  silentLogger,
} from "@ros/adapters/logging/console-logger";
import { createNoopPushSender } from "@ros/adapters/push/providers/noop-push";
import type { RealtimeBus } from "@ros/adapters/realtime/interfaces/realtime";
import { createMemoryBus, createNoopBus } from "@ros/adapters/realtime/providers/memory-bus";
import { createPostgresBus } from "@ros/adapters/realtime/providers/postgres-bus";
import type { ObjectStorage } from "@ros/adapters/storage/interfaces/object-storage";
import { createRazorpayGateway } from "@ros/adapters/payments/providers/razorpay";
import { createLocalStorage } from "@ros/adapters/storage/providers/local-storage";
import { createS3Storage } from "@ros/adapters/storage/providers/s3-storage";

import { createAccessService } from "@ros/application/authz/access-service";
import { appOriginAllowed, getEnv, tenantRole, type ServerEnv } from "@ros/application/config/env";
import type { Logger } from "@ros/application/ports/observability";
import type { PaymentGateway } from "@ros/application/ports/payment-gateway";
import { createEntitlementService } from "@ros/application/subscriptions/entitlement-service";
import {
  createAdjustableClock,
  getContainer,
  setContainerFactory,
  setContainerForTests,
  type Container,
} from "@ros/application/container";

/**
 * Composition root: the only place (besides per-module wiring in this
 * directory) that chooses concrete providers. Everything else depends on
 * the ports in @ros/application/container.
 */
export type { AdjustableClock, Container } from "@ros/application/container";

function selectEmail(env: ServerEnv, logger: Logger): EmailSender {
  if (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY)
    return createResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM);
  if (env.EMAIL_PROVIDER === "brevo" && env.BREVO_API_KEY)
    return createBrevoEmailSender(env.BREVO_API_KEY, env.EMAIL_FROM);
  if (env.EMAIL_PROVIDER !== "outbox")
    logger.warn("email_provider_missing_credentials", { provider: env.EMAIL_PROVIDER });
  return createOutboxEmailSender();
}

export function selectStorage(env: ServerEnv, _logger: Logger): ObjectStorage {
  if (env.STORAGE_PROVIDER === "s3") {
    if (!env.S3_BUCKET || !env.S3_REGION || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY)
      throw new Error(
        "S3 storage selected but S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY are required",
      );
    return createS3Storage({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    });
  }
  return createLocalStorage(env.STORAGE_LOCAL_DIR);
}

export function selectRealtime(env: ServerEnv, logger: Logger): RealtimeBus {
  if (env.REALTIME_PROVIDER === "postgres") {
    if (env.DATABASE_PROVIDER === "pglite")
      throw new Error("REALTIME_PROVIDER=postgres requires DATABASE_PROVIDER=postgres");
    return createPostgresBus({ connectionString: env.DATABASE_URL, logger });
  }
  return env.REALTIME_PROVIDER === "memory" ? createMemoryBus() : createNoopBus();
}

export function selectPaymentGateway(env: ServerEnv): PaymentGateway | null {
  if (env.PAYMENT_PROVIDER !== "razorpay") return null;
  // getEnv() already refuses this combination; the check stays for injected envs (tests).
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET)
    throw new Error(
      "PAYMENT_PROVIDER=razorpay requires RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET",
    );
  return createRazorpayGateway({
    keyId: env.RAZORPAY_KEY_ID,
    keySecret: env.RAZORPAY_KEY_SECRET,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
  });
}

export interface BuildOptions {
  env?: ServerEnv;
  /** Inject a gateway (tests use the fake); undefined selects by env. */
  payments?: PaymentGateway | null;
  /** Inject an existing database (tests). */
  database?: DatabaseHandle;
  migrate?: boolean;
  /** Sync permission catalog, system roles and default settings (default true). */
  syncSystemData?: boolean;
  quiet?: boolean;
}

export async function buildContainer(options: BuildOptions = {}): Promise<Container> {
  const env = options.env ?? getEnv();
  const logger = options.quiet
    ? silentLogger
    : createConsoleLogger(env.LOG_LEVEL, { app: env.APP_NAME });
  const clock = createAdjustableClock();
  // Providers that validate config run first so a bad config opens nothing.
  const email = selectEmail(env, logger);
  const storage = selectStorage(env, logger);
  const payments = options.payments !== undefined ? options.payments : selectPaymentGateway(env);
  const ownsHandle = !options.database;
  const handle =
    options.database ??
    (env.DATABASE_PROVIDER === "pglite"
      ? await connectPglite(env.PGLITE_DATA_DIR)
      : await connectPostgres(env.DATABASE_URL, env.DATABASE_POOL_MAX));
  let realtime: RealtimeBus | undefined;
  try {
    if (options.migrate) await runMigrations(handle, env.DATABASE_PROVIDER);
    else if (
      !options.database &&
      env.DATABASE_PROVIDER === "pglite" &&
      isPersistentPgliteDir(env.PGLITE_DATA_DIR)
    ) {
      const pending = await pendingMigrations(handle);
      if (pending.length > 0) {
        throw new Error(
          `Pending migrations for ${env.PGLITE_DATA_DIR}: ${pending.join(", ")}. Run pnpm db:snapshot then pnpm db:migrate.`,
        );
      }
    }
    const db = handle.db;
    if (tenantRole(env) === null) logger.warn("tenant_role_disabled");
    if (!appOriginAllowed(env))
      logger.warn("allowed_origins_excludes_app_url", {
        appUrl: env.APP_URL,
        allowedOrigins: env.ALLOWED_ORIGINS,
      });
    if (options.syncSystemData !== false) await ensureSystemData(db);

    // System (owner, bypasses row-level security): authentication, the authorization lookup itself,
    // entitlement resolution, rate limits, idempotency and the outbox run before or outside a tenant
    // scope. Module compositions use the tenant runner instead (apps/api/src/composition/runners.ts).
    const entitlements = createEntitlementService({ repo: entitlementRepository(db), clock });
    const access = createAccessService({ repo: accessRepository(db), entitlements });
    realtime = selectRealtime(env, logger);

    return {
      env,
      logger,
      errors: env.ERROR_REPORTER === "log" ? createLogErrorReporter(logger) : { capture: () => {} },
      clock,
      db,
      identity: createLocalIdentityProvider(db, {
        ttlDays: env.SESSION_TTL_DAYS,
        now: clock.now,
        fastHashing: env.NODE_ENV === "test",
      }),
      email,
      storage,
      realtime,
      push: createNoopPushSender(),
      payments,
      access,
      entitlements,
      isReady: async () => {
        await db.execute(sql`select 1`);
        return (await pendingMigrations(handle)).length === 0;
      },
      repos: {
        identity: identityRepository(db),
        access: accessRepository(db),
        audit: auditRepository(db),
        idempotency: idempotencyRepository(db),
        rateLimit: rateLimitRepository(db),
        emailOutbox: emailOutboxRepository(db),
      },
      close: async () => {
        try {
          await realtime?.close?.();
        } finally {
          await handle.close();
        }
      },
    };
  } catch (error) {
    // Cleanup failures are logged so the original build error is what surfaces.
    await realtime
      ?.close?.()
      .catch((e: unknown) => logger.error("container_cleanup_failed", { e }));
    if (ownsHandle)
      await handle.close().catch((e: unknown) => logger.error("container_cleanup_failed", { e }));
    throw error;
  }
}

setContainerFactory(() =>
  buildContainer({
    // Persistent PGlite data is migrated only by `pnpm db:migrate`, after a snapshot.
    migrate:
      getEnv().DATABASE_PROVIDER === "pglite" && !isPersistentPgliteDir(getEnv().PGLITE_DATA_DIR),
  }),
);

export { getContainer, setContainerForTests };
