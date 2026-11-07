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

/** Plain-SQL dump of an embedded PGlite database (schema, data and the drizzle migration table). */
export async function dumpPgliteSql(pg: PGlite): Promise<string> {
  const { pgDump } = await import("@electric-sql/pglite-tools/pg_dump");
  const file = await pgDump({ pg });
  return file.text();
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

/** Run a command with `file` piped to its stdin; read errors and a non-zero exit both reject. */
export async function spawnFromFile(cmd: string, args: string[], file: string): Promise<void> {
  const child = spawn(cmd, args, { stdio: ["pipe", "inherit", "inherit"] });
  const exit = exitPromise(child, cmd);
  exit.catch(() => {});
  await Promise.all([pipeline(createReadStream(file), child.stdin!), exit]).catch((error) => {
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
