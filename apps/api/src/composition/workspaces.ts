import { createSystemRunner, type Executor } from "@ros/database/providers/postgres/client";
import { auditRepository } from "@ros/database/providers/postgres/repositories/core";
import { workspaceRepository } from "@ros/database/providers/postgres/repositories/workspaces";

import type { Container } from "./container";
import { tenantRunner } from "./runners";
import { createWorkspaceService } from "@ros/application/modules/workspaces/service";

/** Per-module wiring: binds the module's repository ports to the Postgres adapter. */
export function workspaceService(c: Container) {
  const build = (e: Executor) => ({
    workspaces: workspaceRepository(e),
    audit: auditRepository(e),
  });
  return createWorkspaceService({
    tx: tenantRunner(c, build),
    // System: bootstrap, the workspace does not exist yet (writes filter by actor.userId).
    bootstrap: createSystemRunner(c.db, build),
    clock: c.clock,
    entitlements: c.entitlements,
    tracking: c.tracking,
    logger: c.logger,
  });
}
