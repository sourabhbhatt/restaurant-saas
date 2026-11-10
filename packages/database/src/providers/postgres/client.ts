import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { PGlite } from "@electric-sql/pglite";
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
  /** The embedded client, present only for PGlite handles (db:dump needs it). */
  pglite?: PGlite;
  close(): Promise<void>;
}

/**
 * Ships with the package, so it resolves the same from any cwd (CLI, tests,
 * Docker). Written with path.join rather than `new URL("./migrations",
 * import.meta.url)`, which Turbopack would try to bundle as an asset.
 */
export const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

/**
 * Bounds on the node-postgres pool so a stalled or unreachable database turns
 * into a prompt 503 instead of a request that waits for the host's timeout:
 * connect attempts, individual statements and idle clients all have a cap.
 */
export const POSTGRES_POOL_OPTIONS = {
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
  // Longer than the slowest UI poll (30 s), so polling reuses warm connections instead of
  // closing and reopening one per poll (measured by the performance workstream).
  idleTimeoutMillis: 60_000,
} as const;

/**
 * pg-pool emits `error` when an idle pooled client loses its connection
 * (database restart, maintenance, idle timeout). Without a listener Node
 * treats it as an unhandled 'error' event and exits the process; the client
 * is already discarded by the pool, so a log line is all that is needed.
 */
export function attachPoolErrorHandler(
  pool: { on(event: "error", listener: (err: Error) => void): unknown },
  log: (line: string) => void = (line) => console.warn(line),
): void {
  pool.on("error", (err) => {
    log(
      JSON.stringify({
        level: "warn",
        msg: "pg_pool_idle_client_error",
        code: (err as { code?: string }).code ?? null,
        message: err.message,
      }),
    );
  });
}

/**
 * Migrations, dump/restore/verify, seed and admin scripts: a connect timeout
 * only. `statement_timeout` is sent in the startup packet and would cancel a
 * long `CREATE INDEX`, backfill or restore verification.
 */
export const MAINTENANCE_POOL_OPTIONS = { connectionTimeoutMillis: 5_000 } as const;

export type PostgresPoolOptions = {
  connectionTimeoutMillis?: number;
  statement_timeout?: number;
  idleTimeoutMillis?: number;
};

/** The pg Pool configuration for `url`, exported so tests can see what each caller gets. */
export function poolConfigFor(
  url: string,
  poolMax: number,
  options: PostgresPoolOptions,
): { connectionString: string; max: number } & PostgresPoolOptions {
  return { connectionString: url, max: poolMax, ...options };
}

/** node-postgres pool for the API runtime (bounded connects, statements and idle clients). */
export async function connectPostgres(
  url: string,
  poolMax = 10,
  options: PostgresPoolOptions = POSTGRES_POOL_OPTIONS,
): Promise<DatabaseHandle> {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const pool = new Pool(poolConfigFor(url, poolMax, options));
  attachPoolErrorHandler(pool);
  const db = drizzle(pool, { schema }) as unknown as Executor;
  return { db, close: () => pool.end() };
}

/** The pool for scripts and the migrate job: no statement timeout (see MAINTENANCE_POOL_OPTIONS). */
export function connectPostgresForMaintenance(url: string, poolMax = 2): Promise<DatabaseHandle> {
  return connectPostgres(url, poolMax, MAINTENANCE_POOL_OPTIONS);
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
  return { db, pglite: client, close: () => client.close() };
}

export async function runMigrations(
  handle: DatabaseHandle,
  provider: "postgres" | "pglite",
  migrationsFolder = MIGRATIONS_DIR,
): Promise<void> {
  if (provider === "pglite") {
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await migrate(handle.db as never, { migrationsFolder });
  } else {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    await migrate(handle.db as never, { migrationsFolder });
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

/**
 * System access narrowed to the named repository methods, each run as its own
 * owner-level read. Lookups that resolve a workspace from a token or id use
 * this so the compiler, not review, keeps them lookup-only.
 */
export function createSystemLookup<Repo extends object, K extends keyof Repo>(
  db: Executor,
  build: (executor: Executor) => Repo,
  methods: readonly K[],
): Pick<Repo, K> {
  const runner = createSystemRunner(db, build);
  const out = {} as Record<K, unknown>;
  for (const name of methods) {
    out[name] = (...args: unknown[]) =>
      runner.read(async (repo) =>
        (repo[name] as (...a: unknown[]) => Promise<unknown>).apply(repo, args),
      );
  }
  return out as Pick<Repo, K>;
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
