import { connectPglite, runMigrations, type DatabaseHandle } from "./client";
import { pendingMigrations } from "./row-counts";
import { snapshotPglite } from "./snapshot";
import { ensureSystemData } from "./system-data";

export interface MigratePersistentDeps {
  snapshot: typeof snapshotPglite;
  open: (dir: string) => Promise<DatabaseHandle>;
  pending: typeof pendingMigrations;
  migrate: (handle: DatabaseHandle) => Promise<void>;
}

const defaults: MigratePersistentDeps = {
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
 * can rewrite its files) only after a safety copy exists.
 */
export async function migratePersistentPglite(
  dir: string,
  snapshotsRoot?: string,
  deps: MigratePersistentDeps = defaults,
): Promise<{ snapshotPath: string; pending: string[] }> {
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
