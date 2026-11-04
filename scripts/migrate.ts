/**
 * Apply database migrations and sync system reference data.
 * Usage: pnpm db:migrate   (uses DATABASE_PROVIDER / DATABASE_URL)
 */
import {
  connectPglite,
  connectPostgres,
  runMigrations,
} from "../src/infrastructure/database/providers/postgres/client";
import { ensureSystemData } from "../src/infrastructure/database/providers/postgres/system-data";

async function main() {
  const provider = process.env.DATABASE_PROVIDER === "pglite" ? "pglite" : "postgres";
  const url =
    process.env.DATABASE_URL ??
    "postgres://restaurantos:restaurantos@localhost:5432/restaurantos_dev";
  const handle =
    provider === "pglite"
      ? await connectPglite(process.env.PGLITE_DATA_DIR)
      : await connectPostgres(url, 2);
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
