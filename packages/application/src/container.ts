import "server-only";

import type { IdentityProvider } from "@ros/adapters/auth/interfaces/identity-provider";
import type { EmailSender } from "@ros/adapters/email/interfaces/email-sender";
import type { PushSender } from "@ros/adapters/push/interfaces/push-sender";
import type { RealtimeBus } from "@ros/adapters/realtime/interfaces/realtime";
import type { ObjectStorage } from "@ros/adapters/storage/interfaces/object-storage";
import type { Executor } from "@ros/database/providers/postgres/client";

import type { AccessService } from "./authz/access-service";
import type { ServerEnv } from "./config/env";
import type {
  AccessRepository,
  AuditRepository,
  EmailOutboxRepository,
  IdempotencyRepository,
  IdentityRepository,
  RateLimitRepository,
} from "./ports/core-repositories";
import type { Clock, ErrorReporter, Logger } from "./ports/observability";
import type { PaymentGateway } from "./ports/payment-gateway";
import type { EntitlementService } from "./subscriptions/entitlement-service";

/**
 * Everything a request handler may reach. Concrete providers are chosen in
 * one composition root (apps/api/src/composition/container.ts); the
 * application only sees this port bundle.
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
  /** Null when PAYMENT_PROVIDER=none: the checkout endpoints and the Pay button are off. */
  payments: PaymentGateway | null;
  access: AccessService;
  entitlements: EntitlementService;
  /** Readiness probe: the database answers and no migration is pending. Throws when unreachable. */
  isReady(): Promise<boolean>;
  repos: {
    identity: IdentityRepository;
    access: AccessRepository;
    audit: AuditRepository;
    idempotency: IdempotencyRepository;
    rateLimit: RateLimitRepository;
    emailOutbox: EmailOutboxRepository;
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

const globalForContainer = globalThis as unknown as {
  __restaurantosContainer?: Promise<Container>;
  __restaurantosContainerFactory?: () => Promise<Container>;
};

/**
 * The composition root registers how to build the process-wide container.
 * Registration happens when apps/api/src/composition/container.ts loads
 * (instrumentation.ts imports it at server start).
 */
export function setContainerFactory(factory: () => Promise<Container>): void {
  globalForContainer.__restaurantosContainerFactory = factory;
}

/** Process-wide singleton (survives dev hot reloads). */
export function getContainer(): Promise<Container> {
  if (!globalForContainer.__restaurantosContainer) {
    const factory = globalForContainer.__restaurantosContainerFactory;
    if (!factory) {
      throw new Error(
        "No container factory registered: the API composition root has not been loaded",
      );
    }
    globalForContainer.__restaurantosContainer = factory().catch((error: unknown) => {
      globalForContainer.__restaurantosContainer = undefined;
      throw error;
    });
  }
  return globalForContainer.__restaurantosContainer;
}

/** Tests: install a specific container as the singleton. */
export function setContainerForTests(container: Container | undefined): void {
  globalForContainer.__restaurantosContainer = container ? Promise.resolve(container) : undefined;
}
