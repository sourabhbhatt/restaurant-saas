import "server-only";

import type { IdentityProvider } from "@/infrastructure/auth/interfaces/identity-provider";
import { createLocalIdentityProvider } from "@/infrastructure/auth/providers/local-identity";
import {
  connectPglite,
  connectPostgres,
  runMigrations,
  type DatabaseHandle,
  type Executor,
} from "@/infrastructure/database/providers/postgres/client";
import {
  accessRepository,
  auditRepository,
  emailOutboxRepository,
  entitlementRepository,
  idempotencyRepository,
  identityRepository,
  rateLimitRepository,
} from "@/infrastructure/database/providers/postgres/repositories/core";
import { pendingMigrations } from "@/infrastructure/database/providers/postgres/row-counts";
import { isPersistentPgliteDir } from "@/infrastructure/database/providers/postgres/snapshot";
import { ensureSystemData } from "@/infrastructure/database/providers/postgres/system-data";
import type { EmailSender } from "@/infrastructure/email/interfaces/email-sender";
import {
  createBrevoEmailSender,
  createResendEmailSender,
} from "@/infrastructure/email/providers/http-senders";
import { createOutboxEmailSender } from "@/infrastructure/email/providers/outbox-sender";
import {
  createConsoleLogger,
  createLogErrorReporter,
  silentLogger,
} from "@/infrastructure/logging/console-logger";
import type { PushSender } from "@/infrastructure/push/interfaces/push-sender";
import { createNoopPushSender } from "@/infrastructure/push/providers/noop-push";
import type { RealtimeBus } from "@/infrastructure/realtime/interfaces/realtime";
import { createMemoryBus, createNoopBus } from "@/infrastructure/realtime/providers/memory-bus";
import type { ObjectStorage } from "@/infrastructure/storage/interfaces/object-storage";
import { createLocalStorage } from "@/infrastructure/storage/providers/local-storage";

import { createAccessService, type AccessService } from "./authz/access-service";
import { getEnv, tenantRole, type ServerEnv } from "./config/env";
import type { Clock, ErrorReporter, Logger } from "./ports/observability";
import {
  createEntitlementService,
  type EntitlementService,
} from "./subscriptions/entitlement-service";

/**
 * Composition root: the only place (besides per-module wiring in
 * src/server/composition) that chooses concrete providers. Everything else
 * depends on ports.
 */
export interface Container {
  env: ServerEnv;
  logger: Logger;
  errors: ErrorReporter;
  clock: AdjustableClock;
  db: Executor;
  identity: IdentityProvider;
  email: EmailSender;
  storage: ObjectStorage;
  realtime: RealtimeBus;
  push: PushSender;
  access: AccessService;
  entitlements: EntitlementService;
  repos: {
    identity: ReturnType<typeof identityRepository>;
    access: ReturnType<typeof accessRepository>;
    audit: ReturnType<typeof auditRepository>;
    idempotency: ReturnType<typeof idempotencyRepository>;
    rateLimit: ReturnType<typeof rateLimitRepository>;
    emailOutbox: ReturnType<typeof emailOutboxRepository>;
  };
  close(): Promise<void>;
}

/** System clock with an offset that only test hooks may change (trial-expiry E2E). */
export interface AdjustableClock extends Clock {
  setOffsetMs(ms: number): void;
  offsetMs(): number;
}

export function createAdjustableClock(): AdjustableClock {
  let offset = 0;
  return {
    now: () => new Date(Date.now() + offset),
    setOffsetMs: (ms) => {
      offset = ms;
    },
    offsetMs: () => offset,
  };
}

function selectEmail(env: ServerEnv, logger: Logger): EmailSender {
  if (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY)
    return createResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM);
  if (env.EMAIL_PROVIDER === "brevo" && env.BREVO_API_KEY)
    return createBrevoEmailSender(env.BREVO_API_KEY, env.EMAIL_FROM);
  if (env.EMAIL_PROVIDER !== "outbox")
    logger.warn("email_provider_missing_credentials", { provider: env.EMAIL_PROVIDER });
  return createOutboxEmailSender();
}

function selectStorage(env: ServerEnv, logger: Logger): ObjectStorage {
  if (env.STORAGE_PROVIDER === "s3") {
    // The S3 adapter is documented in docs/provider-migration-guide.md and
    // requires credentials; until configured, local storage is used.
    logger.warn("storage_s3_not_configured_using_local");
  }
  return createLocalStorage(env.STORAGE_LOCAL_DIR);
}

export interface BuildOptions {
  env?: ServerEnv;
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
  const handle =
    options.database ??
    (env.DATABASE_PROVIDER === "pglite"
      ? await connectPglite(env.PGLITE_DATA_DIR)
      : await connectPostgres(env.DATABASE_URL, env.DATABASE_POOL_MAX));
  if (options.migrate) await runMigrations(handle, env.DATABASE_PROVIDER);
  else if (
    !options.database &&
    env.DATABASE_PROVIDER === "pglite" &&
    isPersistentPgliteDir(env.PGLITE_DATA_DIR)
  ) {
    const pending = await pendingMigrations(handle);
    if (pending.length > 0) {
      await handle.close();
      throw new Error(
        `Pending migrations for ${env.PGLITE_DATA_DIR}: ${pending.join(", ")}. Run pnpm db:snapshot then pnpm db:migrate.`,
      );
    }
  }
  const db = handle.db;
  if (tenantRole(env) === null) logger.warn("tenant_role_disabled");
  if (options.syncSystemData !== false) await ensureSystemData(db);

  const entitlements = createEntitlementService({ repo: entitlementRepository(db), clock });
  const access = createAccessService({ repo: accessRepository(db), entitlements });

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
    email: selectEmail(env, logger),
    storage: selectStorage(env, logger),
    realtime: env.REALTIME_PROVIDER === "memory" ? createMemoryBus() : createNoopBus(),
    push: createNoopPushSender(),
    access,
    entitlements,
    repos: {
      identity: identityRepository(db),
      access: accessRepository(db),
      audit: auditRepository(db),
      idempotency: idempotencyRepository(db),
      rateLimit: rateLimitRepository(db),
      emailOutbox: emailOutboxRepository(db),
    },
    close: () => handle.close(),
  };
}

const globalForContainer = globalThis as unknown as {
  __restaurantosContainer?: Promise<Container>;
};

/** Process-wide singleton (survives dev hot reloads). */
export function getContainer(): Promise<Container> {
  globalForContainer.__restaurantosContainer ??= buildContainer({
    // Persistent PGlite data is migrated only by `pnpm db:migrate`, after a snapshot.
    migrate:
      getEnv().DATABASE_PROVIDER === "pglite" && !isPersistentPgliteDir(getEnv().PGLITE_DATA_DIR),
  }).catch((error: unknown) => {
    globalForContainer.__restaurantosContainer = undefined;
    throw error;
  });
  return globalForContainer.__restaurantosContainer;
}

/** Tests: install a specific container as the singleton. */
export function setContainerForTests(container: Container | undefined): void {
  globalForContainer.__restaurantosContainer = container ? Promise.resolve(container) : undefined;
}
