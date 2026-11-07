import {
  createSystemRunner,
  type Executor,
} from "@/infrastructure/database/providers/postgres/client";
import { analyticsRepository } from "@/infrastructure/database/providers/postgres/repositories/analytics";

import type { Container } from "../container";
import { tenantRunner } from "./runners";
import { createAnalyticsService } from "../modules/analytics/service";

/** Per-module wiring: binds the analytics repository port to the Postgres adapter. */
export function analyticsService(c: Container) {
  const build = (e: Executor) => ({ analytics: analyticsRepository(e) });
  return createAnalyticsService({
    tx: tenantRunner(c, build),
    // System: Super Admin platform aggregates (route auth "platform") count across workspaces.
    platform: createSystemRunner(c.db, build),
    clock: c.clock,
    entitlements: c.entitlements,
  });
}
