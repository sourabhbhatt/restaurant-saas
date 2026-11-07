/**
 * Dump the database to a file plus <file>.manifest.json (per-table row counts).
 * Usage: pnpm db:dump --out <file>
 *   postgres → pg_dump --format=custom --no-owner --no-acl "$DATABASE_URL"
 *   pglite   → plain SQL via @electric-sql/pglite-tools (use a .sql file name)
 * PG_DOCKER_CONTAINER runs pg_dump inside that container (see pgToolCommand).
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import {
  connectPglite,
  connectPostgres,
} from "../src/infrastructure/database/providers/postgres/client";
import {
  dumpPgliteSql,
  pgToolCommand,
  urlForContainer,
  type Manifest,
} from "../src/infrastructure/database/providers/postgres/db-tools";
import { countRows } from "../src/infrastructure/database/providers/postgres/row-counts";

function runToFile(cmd: string, args: string[], out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "inherit"] });
    child.stdout.pipe(createWriteStream(out));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`)),
    );
  });
}

async function main() {
  const { values } = parseArgs({ options: { out: { type: "string" } } });
  if (!values.out) throw new Error("Usage: pnpm db:dump --out <file>");
  const out = path.resolve(values.out);
  await mkdir(path.dirname(out), { recursive: true });
  const provider = process.env.DATABASE_PROVIDER === "pglite" ? "pglite" : "postgres";

  const handle =
    provider === "pglite"
      ? await connectPglite(process.env.PGLITE_DATA_DIR)
      : await connectPostgres(
          process.env.DATABASE_URL ??
            "postgres://restaurantos:restaurantos@localhost:5432/restaurantos_dev",
          2,
        );
  try {
    // Counts first, then the dump, in the same process; nothing else writes during a rehearsal.
    const counts = await countRows(handle.db);
    if (provider === "pglite") {
      await writeFile(out, await dumpPgliteSql(handle.pglite!));
    } else {
      const container = process.env.PG_DOCKER_CONTAINER;
      let url = process.env.DATABASE_URL!;
      if (container) url = urlForContainer(url);
      const { cmd, args } = pgToolCommand(
        "pg_dump",
        ["--format=custom", "--no-owner", "--no-acl", url],
        { container },
      );
      await runToFile(cmd, args, out);
    }
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
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
