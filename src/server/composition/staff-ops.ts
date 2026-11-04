import { createTransactionRunner } from "@/infrastructure/database/providers/postgres/client";
import { auditRepository } from "@/infrastructure/database/providers/postgres/repositories/core";
import { staffOpsRepository } from "@/infrastructure/database/providers/postgres/repositories/staff-ops";

import type { Container } from "../container";
import { createStaffOpsService } from "../modules/staff-ops/service";

/** Per-module wiring for staff operations (waiter, kitchen, branch orders, sessions). */
export function staffOpsService(c: Container) {
  return createStaffOpsService({
    tx: createTransactionRunner(c.db, (db) => ({
      staffOps: staffOpsRepository(db),
      audit: auditRepository(db),
    })),
    access: c.access,
    clock: c.clock,
    realtime: c.realtime,
    logger: c.logger,
  });
}
