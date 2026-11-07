/**
 * Restore a dump into an EMPTY Postgres database.
 * Usage: pnpm db:restore --in <file> --target-url <url>
 *   exits 2 unless the target has tables in "public" or a "drizzle" schema (never overwrites)
 *   exits 3 when tenant roles are missing and this user cannot create them, or when they exist
 *     and this user lacks the ADMIN option needed to grant their memberships
 *   *.sql → psql -v ON_ERROR_STOP=1;  otherwise pg_restore --no-owner --exit-on-error;
 *   both run with --single-transaction (atomic)
 * Privileges and row-level security policies come from the dump itself (dumped with ACLs);
 * only the cluster-level tenant roles and memberships, which no dump contains, are created here.
 * The restoring user need not be the dump's owner: objects are re-owned (--no-owner), and the
 * dump's DEFAULT ACL entries (`ALTER DEFAULT PRIVILEGES FOR ROLE <owner>`) are replayed without
 * FOR ROLE, so they bind to the restoring user (a .sql dump from db:dump is already rewritten).
 * PG_DOCKER_CONTAINER runs the client inside that container (see pgToolCommand).
 */
import { parseArgs } from "node:util";

import { sql } from "drizzle-orm";

import { connectPostgres } from "../src/providers/postgres/client";
import {
  assertEmptyTarget,
  assertTenantRolesCreatable,
  NonEmptyTargetError,
  pgToolCommand,
  rebindDefaultPrivilegesSql,
  spawnCapture,
  spawnFromFile,
  spawnWithInput,
  splitRestoreToc,
  stageListFile,
  TENANT_ROLES_SQL,
  TenantRoleAdminError,
  TenantRolesError,
  tenantRoleStatus,
  urlForContainer,
  type RestoreToc,
} from "../src/providers/postgres/db-tools";

interface CustomPlan {
  toc: RestoreToc;
  /** Rebound DEFAULT ACL statements, or null when the dump has none. */
  replaySql: string | null;
}

/**
 * Read the custom-format dump's TOC and render its DEFAULT ACL entries as SQL
 * (pg_restore -f - needs no database), so a dump that cannot be rebound fails
 * before anything is written.
 */
async function planCustomRestore(file: string, container?: string): Promise<CustomPlan> {
  const list = pgToolCommand("pg_restore", ["-l"], { container, stdin: true });
  const toc = splitRestoreToc(await spawnCapture(list.cmd, list.args, file));
  if (toc.defaultAcl.length === 0) return { toc, replaySql: null };
  const staged = await stageListFile(toc.replay, "default-acl.list", container);
  try {
    const render = pgToolCommand("pg_restore", ["--no-owner", "-L", staged.path, "-f", "-"], {
      container,
      stdin: true,
    });
    return {
      toc,
      replaySql: rebindDefaultPrivilegesSql(await spawnCapture(render.cmd, render.args, file)),
    };
  } finally {
    await staged.cleanup();
  }
}

async function main() {
  const { values } = parseArgs({
    options: { in: { type: "string" }, "target-url": { type: "string" } },
  });
  const file = values.in;
  const target = values["target-url"];
  if (!file || !target) throw new Error("Usage: pnpm db:restore --in <file> --target-url <url>");
  const plainSql = file.endsWith(".sql");
  const container = process.env.PG_DOCKER_CONTAINER;
  const url = container ? urlForContainer(target) : target;

  // Everything derived from the dump is prepared before the first write.
  const plan = plainSql ? null : await planCustomRestore(file, container);

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
    if (error instanceof TenantRolesError || error instanceof TenantRoleAdminError) {
      console.error(error.message);
      process.exit(3);
    }
    throw error;
  } finally {
    await handle.close();
  }

  // The dump is always piped on stdin (psql and pg_restore both read stdin without a file
  // argument), so host and container runs share one path and read errors reject.
  // --single-transaction makes the restore atomic: any failure leaves the target empty.
  // For .sql the roles step is the first statement of that same transaction (CREATE ROLE is
  // transactional); for pg_restore it already committed above.
  if (plainSql) {
    const { cmd, args } = pgToolCommand(
      "psql",
      ["-v", "ON_ERROR_STOP=1", "--single-transaction", "-q", "-d", url],
      { container, stdin: true },
    );
    await spawnFromFile(cmd, args, file, TENANT_ROLES_SQL);
  } else {
    // The DEFAULT ACL entries are the last ones in a dump, so restoring them afterwards keeps
    // the dump's order: default privileges must not be in force while the tables are created,
    // or the credential tables would pick up tenant grants the dump then never revokes.
    const list = plan!.replaySql
      ? await stageListFile(plan!.toc.main, "main.list", container)
      : null;
    try {
      const { cmd, args } = pgToolCommand(
        "pg_restore",
        [
          "--no-owner",
          "--exit-on-error",
          "--single-transaction",
          ...(list ? ["-L", list.path] : []),
          "-d",
          url,
        ],
        { container, stdin: true },
      );
      await spawnFromFile(cmd, args, file);
    } finally {
      await list?.cleanup();
    }
    if (plan!.replaySql) {
      // Idempotent (ALTER DEFAULT PRIVILEGES ... GRANT): safe to re-run by hand if this step fails.
      const { cmd, args } = pgToolCommand(
        "psql",
        ["-v", "ON_ERROR_STOP=1", "--single-transaction", "-q", "-d", url],
        { container, stdin: true },
      );
      await spawnWithInput(cmd, args, plan!.replaySql);
      console.log(
        JSON.stringify({
          level: "info",
          msg: "default_privileges_rebound",
          entries: plan!.toc.defaultAcl.length,
        }),
      );
    }
  }
  console.log(JSON.stringify({ level: "info", msg: "restore_done", file }));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
