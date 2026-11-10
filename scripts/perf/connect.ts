import path from "node:path";

import * as client from "../../packages/database/src/providers/postgres/client";

type Handle = Awaited<ReturnType<typeof client.connectPglite>>;

const ROOT = path.resolve(__dirname, "../..");
const PG_PORT = Number(process.env.PERF_PG_PORT ?? 55150);

/**
 * The harness's own databases only, like assertPerfDatabase in lib.mjs: PGlite
 * under this repo's .data/, or the throwaway Postgres on 127.0.0.1:PERF_PG_PORT.
 * Run by hand against anything else, the perf scripts refuse instead of writing
 * 20,000 synthetic orders into it.
 */
export async function connectPerfDatabase(): Promise<Handle> {
  const url = process.env.PERF_DATABASE_URL;
  if (url) {
    const target = new URL(url);
    if (target.hostname !== "127.0.0.1" || Number(target.port) !== PG_PORT)
      throw new Error(`perf: PERF_DATABASE_URL must point at 127.0.0.1:${PG_PORT}`);
    // The maintenance connector has no API statement timeout (the bulk seed is one long
    // INSERT ... SELECT). Trees from before it existed (the 97467e8 baseline) use connectPostgres.
    const maintenance = (
      client as { connectPostgresForMaintenance?: typeof client.connectPostgres }
    ).connectPostgresForMaintenance;
    return (maintenance ?? client.connectPostgres)(url, 1);
  }
  const dir = path.resolve(process.env.PGLITE_DATA_DIR ?? "");
  if (!process.env.PGLITE_DATA_DIR || !dir.startsWith(path.join(ROOT, ".data") + path.sep))
    throw new Error(`perf: PGLITE_DATA_DIR must be under ${path.join(ROOT, ".data")}`);
  return client.connectPglite(dir);
}
