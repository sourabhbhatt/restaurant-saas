/**
 * Restore a dump into an EMPTY Postgres database.
 * Usage: pnpm db:restore --in <file> --target-url <url>
 *   exits 2 unless the target has zero tables in "public" (never overwrites)
 *   *.sql → psql -v ON_ERROR_STOP=1;  otherwise pg_restore --no-owner --exit-on-error
 * PG_DOCKER_CONTAINER runs the client inside that container (see pgToolCommand).
 */
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { parseArgs } from "node:util";

import { connectPostgres } from "../src/infrastructure/database/providers/postgres/client";
import {
  assertEmptyTarget,
  NonEmptyTargetError,
  pgToolCommand,
  urlForContainer,
} from "../src/infrastructure/database/providers/postgres/db-tools";

function run(cmd: string, args: string[], stdinFile?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: [stdinFile ? "pipe" : "ignore", "inherit", "inherit"],
    });
    if (stdinFile) createReadStream(stdinFile).pipe(child.stdin!);
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`)),
    );
  });
}

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
  if (file.endsWith(".sql")) {
    const { cmd, args } = pgToolCommand("psql", ["-v", "ON_ERROR_STOP=1", "-q", "-d", url], {
      container,
      stdin: Boolean(container),
    });
    // psql reads the file directly on the host; inside a container it is piped on stdin.
    await run(cmd, container ? args : [...args, "-f", file], container ? file : undefined);
  } else {
    const { cmd, args } = pgToolCommand(
      "pg_restore",
      ["--no-owner", "--exit-on-error", "-d", url, ...(container ? [] : [file])],
      { container, stdin: Boolean(container) },
    );
    await run(cmd, args, container ? file : undefined);
  }
  console.log(JSON.stringify({ level: "info", msg: "restore_done", file }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
