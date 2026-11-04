import { createTransactionRunner } from "@/infrastructure/database/providers/postgres/client";
import { auditRepository } from "@/infrastructure/database/providers/postgres/repositories/core";
import { tableRepository } from "@/infrastructure/database/providers/postgres/repositories/tables";

import type { Container } from "../container";
import { createTableService } from "../modules/tables/service";

/** Per-module wiring: binds the tables module's ports to the Postgres adapters. */
export function tableService(c: Container) {
  return createTableService({
    tx: createTransactionRunner(c.db, (db) => ({
      tables: tableRepository(db),
      audit: auditRepository(db),
    })),
    clock: c.clock,
    entitlements: c.entitlements,
    access: c.access,
    appUrl: c.env.APP_URL,
    appSecret: c.env.APP_SECRET,
  });
}
