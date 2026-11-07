import { readFile } from "node:fs/promises";
import path from "node:path";

import { sql } from "drizzle-orm";

import { MIGRATIONS_DIR, type DatabaseHandle, type Executor } from "./client";

function rowsOf<T>(result: unknown): T[] {
  return (Array.isArray(result) ? result : ((result as { rows?: T[] }).rows ?? [])) as T[];
}

/** Exact row count of every table in `public`, keyed and sorted by table name. */
export async function countRows(db: Executor): Promise<Record<string, number>> {
  const tables = rowsOf<{ table_name: string }>(
    await db.execute(
      sql`select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'
          order by table_name`,
    ),
  )
    .map((r) => r.table_name)
    .sort();
  const counts: Record<string, number> = {};
  for (const name of tables) {
    const rows = rowsOf<{ n: string | number }>(
      await db.execute(sql`select count(*) as n from ${sql.identifier(name)}`),
    );
    counts[name] = Number(rows[0]?.n ?? 0);
  }
  return counts;
}

interface JournalEntry {
  tag: string;
  when: number;
}

async function readJournal(): Promise<JournalEntry[]> {
  const raw = await readFile(path.join(MIGRATIONS_DIR, "meta/_journal.json"), "utf8");
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

export async function readJournalTags(): Promise<string[]> {
  return (await readJournal()).map((e) => e.tag);
}

/**
 * Journal tags not yet applied. Drizzle records only a hash and the journal
 * timestamp (`created_at`) per applied migration, and applies every journal
 * entry newer than the latest recorded timestamp, so we compare the same way.
 */
export async function pendingMigrations(handle: DatabaseHandle): Promise<string[]> {
  const journal = await readJournal();
  const exists = rowsOf<{ t: string | null }>(
    await handle.db.execute(sql`select to_regclass('drizzle.__drizzle_migrations') as t`),
  );
  if (!exists[0]?.t) return journal.map((e) => e.tag);
  const last = rowsOf<{ last: string | number | null }>(
    await handle.db.execute(sql`select max(created_at) as last from drizzle.__drizzle_migrations`),
  );
  const lastApplied = last[0]?.last == null ? -1 : Number(last[0].last);
  return journal.filter((e) => e.when > lastApplied).map((e) => e.tag);
}
