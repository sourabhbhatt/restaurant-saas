import { createTransactionRunner } from "@/infrastructure/database/providers/postgres/client";
import { analyticsRepository } from "@/infrastructure/database/providers/postgres/repositories/analytics";

import type { Container } from "../container";
import { createAnalyticsService } from "../modules/analytics/service";

/** Per-module wiring: binds the analytics repository port to the Postgres adapter. */
export function analyticsService(c: Container) {
  return createAnalyticsService({
    tx: createTransactionRunner(c.db, (db) => ({ analytics: analyticsRepository(db) })),
    clock: c.clock,
    entitlements: c.entitlements,
  });
}
