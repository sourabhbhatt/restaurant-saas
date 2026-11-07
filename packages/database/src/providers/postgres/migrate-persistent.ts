import { access } from "node:fs/promises";

import { connectPglite, runMigrations, type DatabaseHandle } from "./client";
import { pendingMigrations } from "./row-counts";
import { snapshotPglite } from "./snapshot";
import { ensureSystemData } from "./system-data";

export interface MigratePersistentDeps {
  /** Whether the data directory already exists; a new one has nothing to snapshot. */
  exists: (dir: string) => Promise<boolean>;
  snapshot: typeof snapshotPglite;
  open: (dir: string) => Promise<DatabaseHandle>;
  pending: typeof pendingMigrations;
  migrate: (handle: DatabaseHandle) => Promise<void>;
}

const defaults: MigratePersistentDeps = {
  exists: (dir) =>
    access(dir).then(
      () => true,
      () => false,
    ),
  snapshot: snapshotPglite,
  open: connectPglite,
  pending: pendingMigrations,
  migrate: async (handle) => {
    await runMigrations(handle, "pglite");
    await ensureSystemData(handle.db);
  },
};

/**
 * Migrates an on-disk PGlite directory. The directory is copied first and
 * pending migrations are detected on the copy, so the original is opened (which
 * can rewrite its files) only after a safety copy exists. A directory that does
 * not exist yet is a new database: it is created and migrated without a snapshot.
 */
export async function migratePersistentPglite(
  dir: string,
  snapshotsRoot?: string,
  deps: MigratePersistentDeps = defaults,
): Promise<{ snapshotPath: string | null; pending: string[] }> {
  if (!(await deps.exists(dir))) {
    const fresh = await deps.open(dir);
    try {
      await deps.migrate(fresh);
    } finally {
      await fresh.close();
    }
    return { snapshotPath: null, pending: ["(new database)"] };
  }
  const snap = await deps.snapshot(dir, snapshotsRoot);
  const copy = await deps.open(snap.dest);
  let pending: string[];
  try {
    pending = await deps.pending(copy);
  } finally {
    await copy.close();
  }
  if (pending.length > 0) {
    const original = await deps.open(dir);
    try {
      await deps.migrate(original);
    } finally {
      await original.close();
    }
  }
  return { snapshotPath: snap.dest, pending };
}
