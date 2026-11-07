/**
 * Restore a dump into an EMPTY Postgres database.
 * Usage: pnpm db:restore --in <file> --target-url <url>
 *   exits 2 unless the target has tables in "public" or a "drizzle" schema (never overwrites)
 *   exits 3 when tenant roles are missing and this user cannot create them
 *   *.sql → psql -v ON_ERROR_STOP=1;  otherwise pg_restore --no-owner --exit-on-error;
 *   both run with --single-transaction (atomic)
 * Privileges and row-level security policies come from the dump itself (dumped with ACLs);
 * only the cluster-level tenant roles and memberships, which no dump contains, are created here.
 * PG_DOCKER_CONTAINER runs the client inside that container (see pgToolCommand).
 */
import { parseArgs } from "node:util";

import { sql } from "drizzle-orm";

import { connectPostgres } from "../src/infrastructure/database/providers/postgres/client";
import {
  assertEmptyTarget,
  assertTenantRolesCreatable,
  NonEmptyTargetError,
  pgToolCommand,
  spawnFromFile,
  TENANT_ROLES_SQL,
  TenantRolesError,
  tenantRoleStatus,
  urlForContainer,
} from "../src/infrastructure/database/providers/postgres/db-tools";

async function main() {
  const { values } = parseArgs({
    options: { in: { type: "string" }, "target-url": { type: "string" } },
  });
  const file = values.in;
  const target = values["target-url"];
  if (!file || !target) throw new Error("Usage: pnpm db:restore --in <file> --target-url <url>");
  const plainSql = file.endsWith(".sql");

  const handle = await connectPostgres(target, 1);
  try {
    await assertEmptyTarget(handle.db);
    await assertTenantRolesCreatable(() => tenantRoleStatus(handle.db));
    // pg_restore cannot take a SQL prefix, so the roles step commits on its own first.
    // If the restore then fails, the leftover roles are harmless and the target stays empty.
    if (!plainSql) await handle.db.transaction((tx) => tx.execute(sql.raw(TENANT_ROLES_SQL)));
  } catch (error) {
    if (error instanceof NonEmptyTargetError) {
      console.error(error.message);
      process.exit(2);
    }
    if (error instanceof TenantRolesError) {
      console.error(error.message);
      process.exit(3);
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
  // For .sql the roles step is the first statement of that same transaction (CREATE ROLE is
  // transactional); for pg_restore it already committed above.
  const { cmd, args } = plainSql
    ? pgToolCommand("psql", ["-v", "ON_ERROR_STOP=1", "--single-transaction", "-q", "-d", url], {
        container,
        stdin: true,
      })
    : pgToolCommand(
        "pg_restore",
        ["--no-owner", "--exit-on-error", "--single-transaction", "-d", url],
        { container, stdin: true },
      );
  await spawnFromFile(cmd, args, file, plainSql ? TENANT_ROLES_SQL : undefined);
  console.log(JSON.stringify({ level: "info", msg: "restore_done", file }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
