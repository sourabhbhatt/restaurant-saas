/**
 * Copy the local PGlite data directory to <data dir parent>/snapshots/pglite-<timestamp>/.
 * Usage: pnpm db:snapshot   (needs DATABASE_PROVIDER=pglite and PGLITE_DATA_DIR;
 * optional SNAPSHOT_DIR overrides the snapshots root)
 */
import { snapshotPglite } from "../src/infrastructure/database/providers/postgres/snapshot";

async function main() {
  const dir = process.env.PGLITE_DATA_DIR;
  if (process.env.DATABASE_PROVIDER !== "pglite" || !dir || dir.startsWith("memory:")) {
    throw new Error("db:snapshot needs DATABASE_PROVIDER=pglite and a persistent PGLITE_DATA_DIR.");
  }
  const { dest, totalRows } = await snapshotPglite(dir, process.env.SNAPSHOT_DIR || undefined);
  console.log(JSON.stringify({ level: "info", msg: "snapshot_written", path: dest, totalRows }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
