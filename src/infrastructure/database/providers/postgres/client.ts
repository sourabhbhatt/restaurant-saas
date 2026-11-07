import { mkdirSync } from "node:fs";
import path from "node:path";

import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import {
  TenantContextError,
  UniqueViolationError,
  type DbContext,
  type TransactionRunner,
} from "../../interfaces/transaction";
import * as schema from "./schema";

export type Schema = typeof schema;
/** Any Drizzle Postgres database or transaction bound to our schema. */
export type Executor = PgDatabase<PgQueryResultHKT, Schema>;

export interface DatabaseHandle {
  db: Executor;
  close(): Promise<void>;
}

export const MIGRATIONS_DIR = path.join(
  process.cwd(),
  "src/infrastructure/database/providers/postgres/migrations",
);

/** node-postgres pool (production and local dev against a real Postgres). */
export async function connectPostgres(url: string, poolMax = 10): Promise<DatabaseHandle> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool({ connectionString: url, max: poolMax });
  const db = drizzle(pool, { schema }) as unknown as Executor;
  return { db, close: () => pool.end() };
}

/** Embedded Postgres (WASM). Used by integration tests; no server needed. */
export async function connectPglite(dataDir?: string): Promise<DatabaseHandle> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  // PGlite does not create missing parent directories.
  if (dataDir && !dataDir.startsWith("memory:"))
    mkdirSync(path.dirname(path.resolve(dataDir)), { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzle(client, { schema }) as unknown as Executor;
  return { db, close: () => client.close() };
}

export async function runMigrations(
  handle: DatabaseHandle,
  provider: "postgres" | "pglite",
): Promise<void> {
  if (provider === "pglite") {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(handle.db as never, { migrationsFolder: MIGRATIONS_DIR });
  } else {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(handle.db as never, { migrationsFolder: MIGRATIONS_DIR });
  }
}

/** Translate driver errors into adapter-neutral errors. */
export function mapDatabaseError(error: unknown): unknown {
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  for (const e of candidates) {
    if (e && typeof e === "object" && "code" in e && (e as { code?: unknown }).code === "23505") {
      return new UniqueViolationError((e as { constraint?: string }).constraint, error);
    }
  }
  return error;
}

/**
 * Runs as the connection user (the table owner), which bypasses the
 * non-forced row-level security policies. Only allow-listed system paths use it.
 */
export function createSystemRunner<R>(
  db: Executor,
  build: (executor: Executor) => R,
): TransactionRunner<R> {
  return {
    async run(work) {
      try {
        return await db.transaction((tx) => work(build(tx as unknown as Executor)));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
    async read(work) {
      try {
        return await work(build(db));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
}

export interface TenantRunnerOptions {
  /** Role to switch into for each transaction; null disables the switch (emergency rollback). */
  role: string | null;
  context: () => DbContext | null;
}

const ROLE_NAME = /^[a-z_][a-z0-9_]*$/;

/**
 * Every `run` and `read` is a transaction that switches into the tenant role
 * and publishes the request context to the row-level security policies.
 * `SET LOCAL` / `set_config(..., true)` end with the transaction, so nothing
 * leaks to the next user of a pooled connection. No context fails closed.
 */
export function createTenantRunner<R>(
  db: Executor,
  build: (executor: Executor) => R,
  options: TenantRunnerOptions,
): TransactionRunner<R> {
  const { role } = options;
  if (role !== null && !ROLE_NAME.test(role)) throw new Error(`Invalid tenant role: ${role}`);
  async function scoped<T>(work: (repos: R) => Promise<T>): Promise<T> {
    const ctx = options.context();
    if (!ctx || (ctx.workspaceId === null && ctx.userId === null))
      throw new TenantContextError("TENANT_CONTEXT_MISSING");
    try {
      return await db.transaction(async (tx) => {
        if (role) await tx.execute(sql.raw(`set local role ${role}`));
        await tx.execute(
          sql`select set_config('app.workspace_id', ${ctx.workspaceId ?? ""}, true), set_config('app.user_id', ${ctx.userId ?? ""}, true)`,
        );
        return work(build(tx as unknown as Executor));
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
  return { run: scoped, read: scoped };
}
