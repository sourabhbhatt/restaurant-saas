import path from "node:path";

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { UniqueViolationError, type TransactionRunner } from "../../interfaces/transaction";
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

export function createTransactionRunner<R>(
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
