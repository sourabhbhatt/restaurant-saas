import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";

import type { Executor } from "./client";

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];
}

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

/** Number of base tables in `public`; restore refuses to run unless it is zero. */
export async function publicTableCount(db: Executor): Promise<number> {
  const rows = rowsOf<{ n: string | number }>(
    await db.execute(
      sql`select count(*) as n from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`,
    ),
  );
  return Number(rows[0]?.n ?? 0);
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
 * pg_dump from PGlite emits statements that only make sense inside PGlite
 * (it wraps `search_path` handling the same way upstream does) plus
 * `CREATE EXTENSION`/`SET` lines that a server may reject. Remove those lines
 * from the DUMP text, never from the data.
 */
export function filterPgliteDump(text: string): { text: string; removed: string[] } {
  const removed: string[] = [];
  const kept = text.split("\n").filter((line) => {
    const drop =
      /^CREATE EXTENSION\b/i.test(line) ||
      /^COMMENT ON EXTENSION\b/i.test(line) ||
      /^SET (default_table_access_method|transaction_timeout)\b/i.test(line);
    if (drop) removed.push(line);
    return !drop;
  });
  return { text: kept.join("\n"), removed };
}

/** Plain-SQL dump of an embedded PGlite database (schema, data and the drizzle migration table). */
export async function dumpPgliteSql(pg: PGlite): Promise<string> {
  const { pgDump } = await import("@electric-sql/pglite-tools/pg_dump");
  const file = await pgDump({ pg });
  return filterPgliteDump(await file.text()).text;
}

export class NonEmptyTargetError extends Error {
  constructor(readonly tables: number) {
    super(`Refusing to restore: target already has ${tables} table(s) in "public".`);
    this.name = "NonEmptyTargetError";
  }
}

/** Restore never overwrites: the target must have no tables in `public`. */
export async function assertEmptyTarget(db: Executor): Promise<void> {
  const tables = await publicTableCount(db);
  if (tables > 0) throw new NonEmptyTargetError(tables);
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
