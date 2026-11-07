import { createTenantRunner, type Executor } from "@ros/database/providers/postgres/client";
import type { TransactionRunner } from "@ros/database/interfaces/transaction";

import { tenantRole } from "@ros/application/config/env";
import type { Container } from "./container";
import { currentDbContext } from "@ros/application/db-context";

/**
 * The default runner for module compositions: row-level security scoped to
 * the workspace (and user) bound to the current request.
 */
export function tenantRunner<R>(c: Container, build: (e: Executor) => R): TransactionRunner<R> {
  return createTenantRunner(c.db, build, { role: tenantRole(c.env), context: currentDbContext });
}
