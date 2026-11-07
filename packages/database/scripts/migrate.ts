/**
 * Apply database migrations and sync system reference data.
 * Usage: pnpm db:migrate   (uses DATABASE_PROVIDER / DATABASE_URL)
 * A persistent PGlite directory with pending migrations is snapshotted first, and only the copy is inspected before the original is migrated.
 */
import { connectPglite, connectPostgres, runMigrations } from "../src/providers/postgres/client";
import { migratePersistentPglite } from "../src/providers/postgres/migrate-persistent";
import { isPersistentPgliteDir } from "../src/providers/postgres/snapshot";
import { ensureSystemData } from "../src/providers/postgres/system-data";

async function main() {
  const provider = process.env.DATABASE_PROVIDER === "pglite" ? "pglite" : "postgres";
  const url =
    process.env.DATABASE_URL ??
    "postgres://restaurantos:restaurantos@localhost:5432/restaurantos_dev";
  const dir = process.env.PGLITE_DATA_DIR;
  if (provider === "pglite" && isPersistentPgliteDir(dir)) {
    const { snapshotPath, pending } = await migratePersistentPglite(
      dir,
      process.env.SNAPSHOT_DIR || undefined,
    );
    if (snapshotPath) {
      console.log(
        JSON.stringify({ level: "info", msg: "snapshot_written", path: snapshotPath, pending }),
      );
    } else {
      console.log(JSON.stringify({ level: "info", msg: "new_database_created", dir }));
    }
    console.log(JSON.stringify({ level: "info", msg: "migrations_applied", provider }));
    return;
  }
  const handle = provider === "pglite" ? await connectPglite(dir) : await connectPostgres(url, 2);
  try {
    await runMigrations(handle, provider);
    await ensureSystemData(handle.db);
    console.log(JSON.stringify({ level: "info", msg: "migrations_applied", provider }));
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
