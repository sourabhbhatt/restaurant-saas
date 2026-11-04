import { createTransactionRunner } from "@/infrastructure/database/providers/postgres/client";
import { auditRepository } from "@/infrastructure/database/providers/postgres/repositories/core";
import { workspaceRepository } from "@/infrastructure/database/providers/postgres/repositories/workspaces";

import type { Container } from "../container";
import { createWorkspaceService } from "../modules/workspaces/service";

/** Per-module wiring: binds the module's repository ports to the Postgres adapter. */
export function workspaceService(c: Container) {
  return createWorkspaceService({
    tx: createTransactionRunner(c.db, (db) => ({
      workspaces: workspaceRepository(db),
      audit: auditRepository(db),
    })),
    clock: c.clock,
    entitlements: c.entitlements,
  });
}
