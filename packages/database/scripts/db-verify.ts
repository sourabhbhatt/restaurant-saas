/**
 * Compare per-table row counts of a target database with a dump manifest.
 * Usage: pnpm db:verify --manifest <file> --target-url <url>
 * Only tables named in the manifest are compared. Exits 1 and prints a diff table on any mismatch.
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";

import { connectPostgres } from "../src/providers/postgres/client";
import { diffCounts, formatMismatches, type Manifest } from "../src/providers/postgres/db-tools";
import { countRows } from "../src/providers/postgres/row-counts";

async function main() {
  const { values } = parseArgs({
    options: { manifest: { type: "string" }, "target-url": { type: "string" } },
  });
  const target = values["target-url"];
  if (!values.manifest || !target) {
    throw new Error("Usage: pnpm db:verify --manifest <file> --target-url <url>");
  }
  const manifest = JSON.parse(await readFile(values.manifest, "utf8")) as Manifest;
  const handle = await connectPostgres(target, 1);
  try {
    const mismatches = diffCounts(manifest.counts, await countRows(handle.db));
    if (mismatches.length > 0) {
      console.error(formatMismatches(mismatches));
      process.exit(1);
    }
    console.log(
      JSON.stringify({
        level: "info",
        msg: "verify_ok",
        tables: Object.keys(manifest.counts).length,
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
