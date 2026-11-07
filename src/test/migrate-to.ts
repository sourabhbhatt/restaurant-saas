import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  MIGRATIONS_DIR,
  runMigrations,
  type DatabaseHandle,
} from "@/infrastructure/database/providers/postgres/client";

/**
 * Applies the migrations up to and including `lastTag` (a journal tag such as
 * `0002_tenant_rls`), so a test can seed data in the older schema and then run
 * the remaining migrations over it. The migrations folder is copied to a temp
 * dir with the journal truncated; the real folder is never modified.
 */
export async function migrateTo(handle: DatabaseHandle, lastTag: string): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), "ros-migrations-"));
  try {
    await cp(MIGRATIONS_DIR, dir, { recursive: true });
    const journalPath = path.join(dir, "meta/_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: { tag: string }[];
    };
    const idx = journal.entries.findIndex((e) => e.tag === lastTag);
    if (idx < 0) throw new Error(`Unknown migration tag: ${lastTag}`);
    journal.entries = journal.entries.slice(0, idx + 1);
    await writeFile(journalPath, JSON.stringify(journal));
    await runMigrations(handle, "pglite", dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
