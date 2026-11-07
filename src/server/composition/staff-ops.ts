import {
  createSystemLookup,
  type Executor,
} from "@/infrastructure/database/providers/postgres/client";
import { auditRepository } from "@/infrastructure/database/providers/postgres/repositories/core";
import { staffOpsRepository } from "@/infrastructure/database/providers/postgres/repositories/staff-ops";

import type { Container } from "../container";
import { tenantRunner } from "./runners";
import { createStaffOpsService } from "../modules/staff-ops/service";

/** Per-module wiring for staff operations (waiter, kitchen, branch orders, sessions). */
export function staffOpsService(c: Container) {
  const build = (e: Executor) => ({
    staffOps: staffOpsRepository(e),
    audit: auditRepository(e),
  });
  return createStaffOpsService({
    tx: tenantRunner(c, build),
    // System: finds the branch owning an order id; the access service then authorizes and binds.
    lookup: createSystemLookup(c.db, staffOpsRepository, ["findOrderBranchId"]),
    access: c.access,
    clock: c.clock,
    realtime: c.realtime,
    logger: c.logger,
  });
}
