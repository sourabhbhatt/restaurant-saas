/**
 * Dump the database to a file plus <file>.manifest.json (per-table row counts).
 * Usage: pnpm db:dump --out <file>
 *   postgres → pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL"
 *   pglite   → plain SQL via @electric-sql/pglite-tools (use a .sql file name);
 *              a persistent PGLITE_DATA_DIR is snapshotted first and only the copy is opened
 * PG_DOCKER_CONTAINER runs pg_dump inside that container (see pgToolCommand).
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { connectPostgres } from "../src/infrastructure/database/providers/postgres/client";
import {
  dumpPgliteDir,
  pgToolCommand,
  resolvePostgresUrl,
  spawnToFile,
  urlForContainer,
  type Manifest,
} from "../src/infrastructure/database/providers/postgres/db-tools";
import { countRows } from "../src/infrastructure/database/providers/postgres/row-counts";

async function main() {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  if (!values.out) throw new Error("Usage: pnpm db:dump --out <file>");
  const out = path.resolve(values.out);
  await mkdir(path.dirname(out), { recursive: true });
  const provider = process.env.DATABASE_PROVIDER === "pglite" ? "pglite" : "postgres";

  let counts: Manifest["counts"];
  if (provider === "pglite") {
    const dumped = await dumpPgliteDir(process.env.PGLITE_DATA_DIR);
    counts = dumped.counts;
    await writeFile(out, dumped.sql);
  } else {
    const url = resolvePostgresUrl(process.env);
    const handle = await connectPostgres(url, 2);
    try {
      // Counts first, then the dump; nothing else writes during a rehearsal.
      counts = await countRows(handle.db);
    } finally {
      await handle.close();
    }
    const container = process.env.PG_DOCKER_CONTAINER;
    const { cmd, args } = pgToolCommand(
      "pg_dump",
      ["--format=custom", "--no-owner", "--no-acl", container ? urlForContainer(url) : url],
      { container },
    );
    await spawnToFile(cmd, args, out);
  }
  // Manifest only after the dump is fully written and the tool exited 0.
  const manifest: Manifest = { createdAt: new Date().toISOString(), provider, counts };
  await writeFile(`${out}.manifest.json`, JSON.stringify(manifest, null, 2) + "\n");
  const rows = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(
    JSON.stringify({
      level: "info",
      msg: "dump_written",
      out,
      tables: Object.keys(counts).length,
      rows,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
