import { createSystemLookup, type Executor } from "@ros/database/providers/postgres/client";
import { auditRepository } from "@ros/database/providers/postgres/repositories/core";
import { tableRepository } from "@ros/database/providers/postgres/repositories/tables";

import type { Container } from "./container";
import { tenantRunner } from "./runners";
import { createTableService } from "@ros/application/modules/tables/service";

/** Per-module wiring: binds the tables module's ports to the Postgres adapters. */
export function tableService(c: Container) {
  const build = (e: Executor) => ({
    tables: tableRepository(e),
    audit: auditRepository(e),
  });
  return createTableService({
    tx: tenantRunner(c, build),
    // System: finds the branch owning a table id; the access service then authorizes and binds.
    lookup: createSystemLookup(c.db, tableRepository, ["locateTable"]),
    clock: c.clock,
    entitlements: c.entitlements,
    access: c.access,
    appUrl: c.env.QR_BASE_URL,
    appSecret: c.env.APP_SECRET,
  });
}
