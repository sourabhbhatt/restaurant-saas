import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";

import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";

import { connectPglite, type DatabaseHandle, type Executor } from "./client";
import { countRows, listPublicTables, rowsOf } from "./row-counts";
import { isPersistentPgliteDir, snapshotPglite } from "./snapshot";

export type TableCounts = Record<string, number>;

export interface Manifest {
  createdAt: string;
  provider: "postgres" | "pglite";
  counts: TableCounts;
}

export interface CountMismatch {
  table: string;
  expected: number | null;
  actual: number | null;
}

/**
 * Per-table differences between a manifest and the target. Only tables named in
 * the manifest are compared: a migrated target may legitimately hold newer tables.
 */
export function diffCounts(expected: TableCounts, actual: TableCounts): CountMismatch[] {
  return Object.keys(expected)
    .sort()
    .filter((table) => expected[table] !== actual[table])
    .map((table) => ({ table, expected: expected[table] ?? null, actual: actual[table] ?? null }));
}

export function formatMismatches(mismatches: CountMismatch[]): string {
  const rows = mismatches.map((m) => [m.table, String(m.expected), String(m.actual ?? "missing")]);
  const widths = [0, 1, 2].map((i) =>
    Math.max(...[["table", "expected", "actual"], ...rows].map((r) => r[i]!.length)),
  );
  const line = (r: string[]) => r.map((cell, i) => cell.padEnd(widths[i]!)).join("  ");
  return [line(["table", "expected", "actual"]), ...rows.map(line)].join("\n");
}

/**
 * Roles and role memberships are cluster-level, so no dump can contain them,
 * yet the dumped policies and grants name the tenant roles. A restore creates
 * exactly these first (only what is missing); everything else, privileges
 * included, comes from the dump itself. One statement, so it can join the
 * restore's transaction.
 */
export const TENANT_ROLES_SQL = `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ros_tenant') THEN
    CREATE ROLE ros_tenant NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ros_runtime') THEN
    CREATE ROLE ros_runtime NOLOGIN;
  END IF;
  IF NOT pg_has_role('ros_runtime', 'ros_tenant', 'MEMBER') THEN
    GRANT ros_tenant TO ros_runtime;
  END IF;
  IF NOT pg_has_role(current_user, 'ros_tenant', 'MEMBER') THEN
    GRANT ros_tenant TO CURRENT_USER;
  END IF;
END
$$;`;

export const TENANT_ROLES = ["ros_tenant", "ros_runtime"] as const;

export interface TenantRoleStatus {
  missing: string[];
  canCreateRoles: boolean;
}

export class TenantRolesError extends Error {
  constructor(readonly missing: string[]) {
    super(
      `Missing role(s) ${missing.join(", ")}. Create roles ros_tenant/ros_runtime (and GRANT ros_tenant TO ros_runtime) as an admin first, or restore with a user that has CREATEROLE.`,
    );
    this.name = "TenantRolesError";
  }
}

/** Which tenant roles the target cluster lacks, and whether the current user may create them. */
export async function tenantRoleStatus(db: Executor): Promise<TenantRoleStatus> {
  const existing = rowsOf<{ rolname: string }>(
    await db.execute(
      sql`select rolname from pg_catalog.pg_roles where rolname in ('ros_tenant', 'ros_runtime')`,
    ),
  ).map((r) => r.rolname);
  const [me] = rowsOf<{ can: boolean }>(
    await db.execute(
      sql`select (rolcreaterole or rolsuper) as can from pg_catalog.pg_roles where rolname = current_user`,
    ),
  );
  return {
    missing: TENANT_ROLES.filter((r) => !existing.includes(r)),
    canCreateRoles: Boolean(me?.can),
  };
}

/** Fail before touching the target when roles are missing and cannot be created. */
export async function assertTenantRolesCreatable(
  status: () => Promise<TenantRoleStatus>,
): Promise<void> {
  const { missing, canCreateRoles } = await status();
  if (missing.length > 0 && !canCreateRoles) throw new TenantRolesError(missing);
}

/** Plain-SQL dump of an embedded PGlite database (schema, data and the drizzle migration table). */
export async function dumpPgliteSql(pg: PGlite): Promise<string> {
  const { pgDump } = await import("@electric-sql/pglite-tools/pg_dump");
  const file = await pgDump({ pg });
  // Self-contained: the dump's policies and grants name the tenant roles.
  return `${TENANT_ROLES_SQL}\n\n${await file.text()}`;
}

export class NonEmptyTargetError extends Error {
  constructor(
    readonly tables: number,
    readonly hasDrizzleSchema = false,
  ) {
    super(
      `Refusing to restore: target already has ${tables} table(s) in "public"` +
        (hasDrizzleSchema ? ' and a "drizzle" schema (migrations were applied)' : "") +
        ".",
    );
    this.name = "NonEmptyTargetError";
  }
}

/** Restore never overwrites: no tables in `public` and no `drizzle` migration schema. */
export async function assertEmptyTarget(db: Executor): Promise<void> {
  const tables = (await listPublicTables(db)).length;
  const schema = rowsOf<{ n: string | number }>(
    await db.execute(
      sql`select count(*) as n from pg_catalog.pg_namespace where nspname = 'drizzle'`,
    ),
  );
  const hasDrizzleSchema = Number(schema[0]?.n ?? 0) > 0;
  if (tables > 0 || hasDrizzleSchema) throw new NonEmptyTargetError(tables, hasDrizzleSchema);
}

export interface DumpPgliteDeps {
  snapshot: typeof snapshotPglite;
  open: (dir?: string) => Promise<DatabaseHandle>;
  count: typeof countRows;
  dump: (pg: PGlite) => Promise<string>;
}

const dumpDefaults: DumpPgliteDeps = {
  snapshot: snapshotPglite,
  open: connectPglite,
  count: countRows,
  dump: dumpPgliteSql,
};

/**
 * Plain-SQL dump plus row counts of a PGlite directory. A persistent directory
 * is snapshotted first and only the copy is opened, so opening never rewrites
 * the original's files.
 */
export async function dumpPgliteDir(
  dir: string | undefined,
  deps: DumpPgliteDeps = dumpDefaults,
): Promise<{ sql: string; counts: TableCounts }> {
  const target = isPersistentPgliteDir(dir) ? (await deps.snapshot(dir)).dest : dir;
  const handle = await deps.open(target);
  try {
    return { sql: await deps.dump(handle.pglite!), counts: await deps.count(handle.db) };
  } finally {
    await handle.close();
  }
}

const DEV_DATABASE_URL = "postgres://restaurantos:restaurantos@localhost:5432/restaurantos_dev";

/** The Postgres URL used for both the row-count connection and pg_dump. */
export function resolvePostgresUrl(env: Record<string, string | undefined>): string {
  const url = env.DATABASE_URL ?? DEV_DATABASE_URL;
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error("DATABASE_URL must be a postgres:// or postgresql:// URL.");
  }
  return url;
}

function exitPromise(child: ReturnType<typeof spawn>, cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`)),
    );
  });
}

/** Run a command, writing its stdout to `out`; resolves only after the file is flushed and the exit code is 0. */
export async function spawnToFile(cmd: string, args: string[], out: string): Promise<void> {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "inherit"] });
  const exit = exitPromise(child, cmd);
  exit.catch(() => {}); // surfaced through Promise.all below
  await Promise.all([pipeline(child.stdout!, createWriteStream(out)), exit]).catch((error) => {
    child.kill();
    throw error;
  });
}

/**
 * Run a command with `file` piped to its stdin (after `prefix`, when given);
 * read errors and a non-zero exit both reject.
 */
export async function spawnFromFile(
  cmd: string,
  args: string[],
  file: string,
  prefix?: string,
): Promise<void> {
  const child = spawn(cmd, args, { stdio: ["pipe", "inherit", "inherit"] });
  const exit = exitPromise(child, cmd);
  exit.catch(() => {});
  async function* input() {
    if (prefix) yield Buffer.from(`${prefix}\n`);
    yield* createReadStream(file);
  }
  await Promise.all([pipeline(input, child.stdin!), exit]).catch((error) => {
    child.kill();
    throw error;
  });
}

/**
 * Run a PostgreSQL client tool, optionally inside a container. A host client
 * older than the server cannot dump it (pg_dump 16 refuses an 18 server), so
 * PG_DOCKER_CONTAINER runs the tool from the server's own image; connection
 * URLs then point at the container's own port 5432.
 */
export function pgToolCommand(
  tool: "pg_dump" | "pg_restore" | "psql",
  args: string[],
  opts: { container?: string; stdin?: boolean } = {},
): { cmd: string; args: string[] } {
  if (!opts.container) return { cmd: tool, args };
  const exec = opts.stdin ? ["exec", "-i"] : ["exec"];
  return { cmd: "docker", args: [...exec, opts.container, tool, ...args] };
}

export function urlForContainer(url: string): string {
  const u = new URL(url);
  u.hostname = "localhost";
  u.port = "5432";
  return u.toString();
}
