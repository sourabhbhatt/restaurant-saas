/**
 * Restore a dump into an EMPTY Postgres database.
 * Usage: pnpm db:restore --in <file> --target-url <url>
 *   exits 2 unless the target has tables in "public" or a "drizzle" schema (never overwrites)
 *   *.sql → psql -v ON_ERROR_STOP=1;  otherwise pg_restore --no-owner --exit-on-error;
 *   both run with --single-transaction (atomic)
 * PG_DOCKER_CONTAINER runs the client inside that container (see pgToolCommand).
 */
import { parseArgs } from "node:util";

import { connectPostgres } from "../src/infrastructure/database/providers/postgres/client";
import {
  assertEmptyTarget,
  NonEmptyTargetError,
  pgToolCommand,
  spawnFromFile,
  urlForContainer,
} from "../src/infrastructure/database/providers/postgres/db-tools";

async function main() {
  const { values } = parseArgs({
    options: { in: { type: "string" }, "target-url": { type: "string" } },
  });
  const file = values.in;
  const target = values["target-url"];
  if (!file || !target) throw new Error("Usage: pnpm db:restore --in <file> --target-url <url>");

  const handle = await connectPostgres(target, 1);
  try {
    await assertEmptyTarget(handle.db);
  } catch (error) {
    if (error instanceof NonEmptyTargetError) {
      console.error(error.message);
      process.exit(2);
    }
    throw error;
  } finally {
    await handle.close();
  }

  const container = process.env.PG_DOCKER_CONTAINER;
  const url = container ? urlForContainer(target) : target;
  // The dump is always piped on stdin (psql and pg_restore both read stdin without a file
  // argument), so host and container runs share one path and read errors reject.
  // --single-transaction makes the restore atomic: any failure leaves the target empty.
  const { cmd, args } = file.endsWith(".sql")
    ? pgToolCommand("psql", ["-v", "ON_ERROR_STOP=1", "--single-transaction", "-q", "-d", url], {
        container,
        stdin: true,
      })
    : pgToolCommand(
        "pg_restore",
        ["--no-owner", "--exit-on-error", "--single-transaction", "-d", url],
        { container, stdin: true },
      );
  await spawnFromFile(cmd, args, file);
  console.log(JSON.stringify({ level: "info", msg: "restore_done", file }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
