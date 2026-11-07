/**
 * Apply database migrations and sync system reference data.
 * Usage: pnpm db:migrate   (uses DATABASE_PROVIDER / DATABASE_URL)
 * A persistent PGlite directory with pending migrations is snapshotted first.
 */
import {
  connectPglite,
  connectPostgres,
  runMigrations,
} from "../src/infrastructure/database/providers/postgres/client";
import { pendingMigrations } from "../src/infrastructure/database/providers/postgres/row-counts";
import {
  isPersistentPgliteDir,
  snapshotPglite,
} from "../src/infrastructure/database/providers/postgres/snapshot";
import { ensureSystemData } from "../src/infrastructure/database/providers/postgres/system-data";

async function main() {
  const provider = process.env.DATABASE_PROVIDER === "pglite" ? "pglite" : "postgres";
  const url =
    process.env.DATABASE_URL ??
    "postgres://restaurantos:restaurantos@localhost:5432/restaurantos_dev";
  const dir = process.env.PGLITE_DATA_DIR;
  const handle = provider === "pglite" ? await connectPglite(dir) : await connectPostgres(url, 2);
  try {
    if (provider === "pglite" && isPersistentPgliteDir(dir)) {
      const pending = await pendingMigrations(handle);
      if (pending.length > 0) {
        // PGlite allows a single opener, so release the original before copying it.
        await handle.close();
        const snap = await snapshotPglite(dir, process.env.SNAPSHOT_DIR || undefined);
        console.log(
          JSON.stringify({ level: "info", msg: "snapshot_written", path: snap.dest, pending }),
        );
        const reopened = await connectPglite(dir);
        await runMigrations(reopened, provider);
        await ensureSystemData(reopened.db);
        await reopened.close();
        console.log(JSON.stringify({ level: "info", msg: "migrations_applied", provider }));
        return;
      }
    }
    await runMigrations(handle, provider);
    await ensureSystemData(handle.db);
    console.log(JSON.stringify({ level: "info", msg: "migrations_applied", provider }));
  } finally {
    await handle.close().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
