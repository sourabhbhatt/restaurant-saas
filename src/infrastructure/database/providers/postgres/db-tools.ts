import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import type { PGlite } from "@electric-sql/pglite";
import { sql } from "drizzle-orm";

import { connectPglite, type DatabaseHandle, type Executor } from "./client";
import { countRows, listPublicTables, rowsOf } from "./row-counts";
import { isPersistentPgliteDir, snapshotPglite } from "./snapshot";

export type TableCounts = Record<string, number>;

export interface Manifest {
  createdAt: string;
  provider: "postgres" | "pglite";
  counts: TableCounts;
}

export interface CountMismatch {
  table: string;
  expected: number | null;
  actual: number | null;
}

/**
 * Per-table differences between a manifest and the target. Only tables named in
 * the manifest are compared: a migrated target may legitimately hold newer tables.
 */
export function diffCounts(expected: TableCounts, actual: TableCounts): CountMismatch[] {
  return Object.keys(expected)
    .sort()
    .filter((table) => expected[table] !== actual[table])
    .map((table) => ({ table, expected: expected[table] ?? null, actual: actual[table] ?? null }));
}

export function formatMismatches(mismatches: CountMismatch[]): string {
  const rows = mismatches.map((m) => [m.table, String(m.expected), String(m.actual ?? "missing")]);
  const widths = [0, 1, 2].map((i) =>
    Math.max(...[["table", "expected", "actual"], ...rows].map((r) => r[i]!.length)),
  );
  const line = (r: string[]) => r.map((cell, i) => cell.padEnd(widths[i]!)).join("  ");
  return [line(["table", "expected", "actual"]), ...rows.map(line)].join("\n");
}

/**
 * Roles and role memberships are cluster-level, so no dump can contain them,
 * yet the dumped policies and grants name the tenant roles. A restore creates
 * exactly these first (only what is missing); everything else, privileges
 * included, comes from the dump itself. One statement, so it can join the
 * restore's transaction.
 *
 * The self-grant is guarded on SET, not MEMBER: on PostgreSQL 16+ a CREATEROLE
 * user that creates ros_tenant is already a MEMBER (ADMIN only, no SET), and the
 * app's `SET LOCAL ROLE ros_tenant` needs the SET option.
 */
export const TENANT_ROLES_SQL = `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ros_tenant') THEN
    CREATE ROLE ros_tenant NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ros_runtime') THEN
    CREATE ROLE ros_runtime NOLOGIN;
  END IF;
  IF NOT pg_has_role('ros_runtime', 'ros_tenant', 'MEMBER') THEN
    GRANT ros_tenant TO ros_runtime;
  END IF;
  IF NOT pg_has_role(current_user, 'ros_tenant', 'SET') THEN
    GRANT ros_tenant TO CURRENT_USER;
  END IF;
END
$$;`;

export const TENANT_ROLES = ["ros_tenant", "ros_runtime"] as const;

export interface TenantRoleStatus {
  missing: string[];
  canCreateRoles: boolean;
  /** The memberships TENANT_ROLES_SQL would have to GRANT, as "ros_tenant TO <role>". */
  grantsNeeded: string[];
  /** Superuser, or holds the ADMIN option on ros_tenant (directly or inherited). */
  canGrantTenant: boolean;
}

export class TenantRolesError extends Error {
  constructor(readonly missing: string[]) {
    super(
      `Missing role(s) ${missing.join(", ")}. Create roles ros_tenant/ros_runtime (and GRANT ros_tenant TO ros_runtime) as an admin first, or restore with a user that has CREATEROLE.`,
    );
    this.name = "TenantRolesError";
  }
}

export class TenantRoleAdminError extends Error {
  constructor(readonly grantsNeeded: string[]) {
    const grants = grantsNeeded.map((g) => `GRANT ${g}`);
    super(
      `Role ros_tenant exists but the restoring user lacks the ADMIN option on it, so ${grants
        .map((g) => `"${g}"`)
        .join(
          ", ",
        )} would fail. As an admin run: ${grants.join("; ")}; (or GRANT ros_tenant TO <restoring user> WITH ADMIN OPTION).`,
    );
    this.name = "TenantRoleAdminError";
  }
}

/**
 * Which tenant roles the target cluster lacks, whether the current user may
 * create them, and whether the memberships TENANT_ROLES_SQL would grant are
 * within its rights (pg_has_role has no ADMIN mode; pg_auth_members does).
 */
export async function tenantRoleStatus(db: Executor): Promise<TenantRoleStatus> {
  const [row] = rowsOf<{
    tenant: boolean;
    runtime: boolean;
    can_create: boolean;
    runtime_member: boolean;
    me_set: boolean;
    me: string;
    can_grant: boolean;
  }>(
    await db.execute(sql`
      with t as (select oid from pg_catalog.pg_roles where rolname = 'ros_tenant'),
           r as (select oid from pg_catalog.pg_roles where rolname = 'ros_runtime'),
           me as (select rolname, rolsuper, rolcreaterole from pg_catalog.pg_roles where rolname = current_user)
      select exists (select 1 from t) as tenant,
             exists (select 1 from r) as runtime,
             (select rolcreaterole or rolsuper from me) as can_create,
             coalesce((select pg_has_role(r.oid, t.oid, 'MEMBER') from r, t), false) as runtime_member,
             coalesce((select pg_has_role(current_user, t.oid, 'SET') from t), false) as me_set,
             (select rolname from me) as me,
             (select rolsuper from me)
               or exists (select 1 from pg_catalog.pg_auth_members m, t
                          where m.roleid = t.oid and m.admin_option
                            and pg_has_role(current_user, m.member, 'USAGE')) as can_grant`),
  );
  const existing = [row!.tenant && "ros_tenant", row!.runtime && "ros_runtime"];
  const grantsNeeded: string[] = [];
  if (!row!.runtime_member) grantsNeeded.push("ros_tenant TO ros_runtime");
  if (!row!.me_set) grantsNeeded.push(`ros_tenant TO ${row!.me}`);
  return {
    missing: TENANT_ROLES.filter((r) => !existing.includes(r)),
    canCreateRoles: Boolean(row!.can_create),
    grantsNeeded,
    canGrantTenant: Boolean(row!.can_grant),
  };
}

/**
 * Fail before touching the target when TENANT_ROLES_SQL could not run to completion:
 * roles missing without CREATEROLE, or ros_tenant pre-existing (so creating it does not
 * confer ADMIN) while a membership still has to be granted by a user without ADMIN on it.
 */
export async function assertTenantRolesCreatable(
  status: () => Promise<TenantRoleStatus>,
): Promise<void> {
  const { missing, canCreateRoles, grantsNeeded, canGrantTenant } = await status();
  if (missing.length > 0 && !canCreateRoles) throw new TenantRolesError(missing);
  if (!missing.includes("ros_tenant") && grantsNeeded.length > 0 && !canGrantTenant)
    throw new TenantRoleAdminError(grantsNeeded);
}

const DEFAULT_PRIVILEGES_FOR_ROLE =
  /^ALTER DEFAULT PRIVILEGES FOR ROLE (?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*) (?=IN SCHEMA |GRANT |REVOKE )/;
const COPY_START = /^COPY .* FROM stdin;$/;

/**
 * Rebind a dump's default privileges to whoever restores it. pg_dump writes
 * `ALTER DEFAULT PRIVILEGES FOR ROLE <dump owner> …`, which needs membership in
 * that role and, worse, leaves later migrations run by another user without the
 * tenant grants. Without FOR ROLE the statement applies to the restoring user,
 * which is what migration 0002 wrote in the first place. Only that statement
 * prefix at the start of a line is rewritten, and COPY blocks (data) are skipped
 * whole: a row that happens to contain the text is left byte for byte.
 */
export function rebindDefaultPrivileges(dump: string): string {
  let inCopy = false;
  return dump
    .split("\n")
    .map((raw) => {
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (inCopy) {
        if (line === "\\.") inCopy = false;
        return raw;
      }
      if (COPY_START.test(line)) {
        inCopy = true;
        return raw;
      }
      return raw.replace(DEFAULT_PRIVILEGES_FOR_ROLE, "ALTER DEFAULT PRIVILEGES ");
    })
    .join("\n");
}

/** Plain-SQL dump of an embedded PGlite database (schema, data and the drizzle migration table). */
export async function dumpPgliteSql(pg: PGlite): Promise<string> {
  const { pgDump } = await import("@electric-sql/pglite-tools/pg_dump");
  // --no-owner: PGlite's single user is `postgres`; the restoring user owns what it restores.
  const file = await pgDump({ pg, args: ["--no-owner"] });
  // Self-contained: the dump's policies and grants name the tenant roles.
  return `${TENANT_ROLES_SQL}\n\n${rebindDefaultPrivileges(await file.text())}`;
}

const TOC_DEFAULT_ACL = /^\d+; \d+ \d+ DEFAULT ACL /;

export interface RestoreToc {
  /** The dump's DEFAULT ACL entries, verbatim. */
  defaultAcl: string[];
  /** The `pg_restore -L` list for the main restore: everything except DEFAULT ACL. */
  main: string;
  /** The `pg_restore -L` list that selects only the DEFAULT ACL entries. */
  replay: string;
}

/**
 * Split a `pg_restore -l` listing so the DEFAULT ACL entries can be restored
 * separately: `--no-owner` re-owns every object but leaves `ALTER DEFAULT
 * PRIVILEGES FOR ROLE <dump owner>` as is. In a list file a `;` prefix comments an
 * entry out. The entries are the dump's own; nothing is read from migrations.
 */
export function splitRestoreToc(toc: string): RestoreToc {
  const defaultAcl: string[] = [];
  const main = toc
    .split("\n")
    .map((line) => {
      if (!TOC_DEFAULT_ACL.test(line)) return line;
      defaultAcl.push(line);
      return `;${line}`;
    })
    .join("\n");
  return { defaultAcl, main, replay: defaultAcl.map((l) => `${l}\n`).join("") };
}

export class DefaultPrivilegesError extends Error {
  constructor(readonly statements: string[]) {
    super(
      `The dump's default privileges could not be rebound to the restoring user:\n${statements.join("\n")}`,
    );
    this.name = "DefaultPrivilegesError";
  }
}

/**
 * The replay SQL for a dump's DEFAULT ACL entries, rebound to the restoring user.
 * Fails (before anything is written) if a FOR ROLE statement survives the rewrite.
 */
export function rebindDefaultPrivilegesSql(replaySql: string): string {
  const rebound = rebindDefaultPrivileges(replaySql);
  const leftovers = rebound
    .split("\n")
    .filter((l) => /^ALTER DEFAULT PRIVILEGES\b.*\bFOR ROLE\b/.test(l));
  if (leftovers.length > 0) throw new DefaultPrivilegesError(leftovers);
  return rebound;
}

export class NonEmptyTargetError extends Error {
  constructor(
    readonly tables: number,
    readonly hasDrizzleSchema = false,
  ) {
    super(
      `Refusing to restore: target already has ${tables} table(s) in "public"` +
        (hasDrizzleSchema ? ' and a "drizzle" schema (migrations were applied)' : "") +
        ".",
    );
    this.name = "NonEmptyTargetError";
  }
}

/** Restore never overwrites: no tables in `public` and no `drizzle` migration schema. */
export async function assertEmptyTarget(db: Executor): Promise<void> {
  const tables = (await listPublicTables(db)).length;
  const schema = rowsOf<{ n: string | number }>(
    await db.execute(
      sql`select count(*) as n from pg_catalog.pg_namespace where nspname = 'drizzle'`,
    ),
  );
  const hasDrizzleSchema = Number(schema[0]?.n ?? 0) > 0;
  if (tables > 0 || hasDrizzleSchema) throw new NonEmptyTargetError(tables, hasDrizzleSchema);
}

export interface DumpPgliteDeps {
  snapshot: typeof snapshotPglite;
  open: (dir?: string) => Promise<DatabaseHandle>;
  count: typeof countRows;
  dump: (pg: PGlite) => Promise<string>;
}

const dumpDefaults: DumpPgliteDeps = {
  snapshot: snapshotPglite,
  open: connectPglite,
  count: countRows,
  dump: dumpPgliteSql,
};

/**
 * Plain-SQL dump plus row counts of a PGlite directory. A persistent directory
 * is snapshotted first and only the copy is opened, so opening never rewrites
 * the original's files.
 */
export async function dumpPgliteDir(
  dir: string | undefined,
  deps: DumpPgliteDeps = dumpDefaults,
): Promise<{ sql: string; counts: TableCounts }> {
  const target = isPersistentPgliteDir(dir) ? (await deps.snapshot(dir)).dest : dir;
  const handle = await deps.open(target);
  try {
    return { sql: await deps.dump(handle.pglite!), counts: await deps.count(handle.db) };
  } finally {
    await handle.close();
  }
}

const DEV_DATABASE_URL = "postgres://restaurantos:restaurantos@localhost:5432/restaurantos_dev";

/** The Postgres URL used for both the row-count connection and pg_dump. */
export function resolvePostgresUrl(env: Record<string, string | undefined>): string {
  const url = env.DATABASE_URL ?? DEV_DATABASE_URL;
  if (!/^postgres(ql)?:\/\//.test(url)) {
    throw new Error("DATABASE_URL must be a postgres:// or postgresql:// URL.");
  }
  return url;
}

function exitPromise(child: ReturnType<typeof spawn>, cmd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`)),
    );
  });
}

/** Run a command, writing its stdout to `out`; resolves only after the file is flushed and the exit code is 0. */
export async function spawnToFile(cmd: string, args: string[], out: string): Promise<void> {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "inherit"] });
  const exit = exitPromise(child, cmd);
  exit.catch(() => {}); // surfaced through Promise.all below
  await Promise.all([pipeline(child.stdout!, createWriteStream(out)), exit]).catch((error) => {
    child.kill();
    throw error;
  });
}

type Chunks = () => AsyncIterable<Buffer | string>;

async function runWithStdin(
  cmd: string,
  args: string[],
  input: Chunks,
  stdout: "inherit" | "pipe",
): Promise<string> {
  const child = spawn(cmd, args, { stdio: ["pipe", stdout, "inherit"] });
  const exit = exitPromise(child, cmd);
  exit.catch(() => {});
  const captured: Buffer[] = [];
  const capture = async () => {
    if (stdout === "pipe") for await (const chunk of child.stdout!) captured.push(chunk as Buffer);
  };
  await Promise.all([pipeline(input, child.stdin!), capture(), exit]).catch((error) => {
    child.kill();
    throw error;
  });
  return Buffer.concat(captured).toString("utf8");
}

/**
 * Run a command with `file` piped to its stdin (after `prefix`, when given);
 * read errors and a non-zero exit both reject.
 */
export async function spawnFromFile(
  cmd: string,
  args: string[],
  file: string,
  prefix?: string,
): Promise<void> {
  await runWithStdin(
    cmd,
    args,
    async function* () {
      if (prefix) yield Buffer.from(`${prefix}\n`);
      yield* createReadStream(file);
    },
    "inherit",
  );
}

/** Run a command with `text` on its stdin. */
export async function spawnWithInput(cmd: string, args: string[], text: string): Promise<void> {
  await runWithStdin(
    cmd,
    args,
    async function* () {
      yield Buffer.from(text);
    },
    "inherit",
  );
}

/** Run a command with `file` on its stdin and return its stdout. */
export async function spawnCapture(cmd: string, args: string[], file: string): Promise<string> {
  return runWithStdin(
    cmd,
    args,
    async function* () {
      yield* createReadStream(file);
    },
    "pipe",
  );
}

/**
 * Make a small text file (a `pg_restore -L` list) visible to the client tool:
 * on the host that is the temp file itself; inside a container it is copied to
 * /tmp, since stdin already carries the dump.
 */
export async function stageListFile(
  content: string,
  name: string,
  container?: string,
): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "ros-restore-"));
  const local = path.join(dir, name);
  await writeFile(local, content);
  const removeLocal = () => rm(dir, { recursive: true, force: true });
  if (!container) return { path: local, cleanup: removeLocal };
  const remote = `/tmp/${path.basename(dir)}-${name}`;
  await runWithStdin(
    "docker",
    ["cp", local, `${container}:${remote}`],
    async function* () {},
    "inherit",
  );
  return {
    path: remote,
    cleanup: async () => {
      await removeLocal();
      await runWithStdin(
        "docker",
        ["exec", container, "rm", "-f", remote],
        async function* () {},
        "inherit",
      );
    },
  };
}

/**
 * Run a PostgreSQL client tool, optionally inside a container. A host client
 * older than the server cannot dump it (pg_dump 16 refuses an 18 server), so
 * PG_DOCKER_CONTAINER runs the tool from the server's own image; connection
 * URLs then point at the container's own port 5432.
 */
export function pgToolCommand(
  tool: "pg_dump" | "pg_restore" | "psql",
  args: string[],
  opts: { container?: string; stdin?: boolean } = {},
): { cmd: string; args: string[] } {
  if (!opts.container) return { cmd: tool, args };
  const exec = opts.stdin ? ["exec", "-i"] : ["exec"];
  return { cmd: "docker", args: [...exec, opts.container, tool, ...args] };
}

export function urlForContainer(url: string): string {
  const u = new URL(url);
  u.hostname = "localhost";
  u.port = "5432";
  return u.toString();
}
