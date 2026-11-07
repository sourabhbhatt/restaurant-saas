import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  connectPglite,
  runMigrations,
  type DatabaseHandle,
} from "@/infrastructure/database/providers/postgres/client";
import {
  assertEmptyTarget,
  assertTenantRolesCreatable,
  diffCounts,
  dumpPgliteSql,
  dumpPgliteDir,
  NonEmptyTargetError,
  resolvePostgresUrl,
  spawnFromFile,
  spawnToFile,
  TenantRolesError,
  type DumpPgliteDeps,
} from "@/infrastructure/database/providers/postgres/db-tools";
import { countRows } from "@/infrastructure/database/providers/postgres/row-counts";

const handles: DatabaseHandle[] = [];

/** Tenant roles, their memberships, table/column grants and RLS policies, in a comparable form. */
async function securityState(db: DatabaseHandle["db"]) {
  const q = async <T>(query: ReturnType<typeof sql>) =>
    (await db.execute(query)) as unknown as { rows: T[] };
  const list = async (query: ReturnType<typeof sql>) =>
    (await q<{ v: string }>(query)).rows.map((r) => r.v);
  return {
    roles: await list(
      sql`select rolname as v from pg_roles where rolname in ('ros_tenant', 'ros_runtime') order by 1`,
    ),
    runtimeIsTenant: await list(
      sql`select 'yes' as v from pg_auth_members m
          join pg_roles g on g.oid = m.roleid and g.rolname = 'ros_tenant'
          join pg_roles r on r.oid = m.member and r.rolname = 'ros_runtime'`,
    ),
    tableGrants: await list(
      sql`select grantee || ':' || table_name || ':' || privilege_type as v
          from information_schema.role_table_grants
          where grantee in ('ros_tenant', 'ros_runtime') order by 1`,
    ),
    columnGrants: await list(
      sql`select column_name as v from information_schema.column_privileges
          where grantee = 'ros_tenant' and table_name = 'users' and privilege_type = 'SELECT' order by 1`,
    ),
    policies: await list(
      sql`select tablename || ':' || policyname || ':' || roles::text || ':' || cmd || ':' ||
                 coalesce(qual, '') || ':' || coalesce(with_check, '') as v
          from pg_policies where schemaname = 'public' order by 1`,
    ),
  };
}
afterAll(async () => {
  for (const h of handles) await h.close();
});

async function migrated() {
  const h = await connectPglite();
  handles.push(h);
  await runMigrations(h, "pglite");
  return h;
}

describe("db tools", () => {
  it("restore refuses a non-empty target", async () => {
    const h = await migrated();
    await expect(assertEmptyTarget(h.db)).rejects.toBeInstanceOf(NonEmptyTargetError);
    const empty = await connectPglite();
    handles.push(empty);
    await expect(assertEmptyTarget(empty.db)).resolves.toBeUndefined();
  });

  it("verify detects a missing row", async () => {
    const h = await migrated();
    await h.db.execute(
      sql`insert into users (email, name) values ('a@example.com', 'A'), ('b@example.com', 'B')`,
    );
    const manifest = await countRows(h.db);
    expect(diffCounts(manifest, await countRows(h.db))).toEqual([]);
    await h.db.execute(sql`delete from users where email = 'b@example.com'`);
    expect(diffCounts(manifest, await countRows(h.db))).toEqual([
      { table: "users", expected: 2, actual: 1 },
    ]);
    expect(diffCounts({ gone: 1 }, {})).toEqual([{ table: "gone", expected: 1, actual: null }]);
  });

  it("dump→restore round-trip preserves counts", async () => {
    const src = await migrated();
    await src.db.execute(sql`insert into users (email, name) values ('a@example.com', 'A')`);
    const before = await countRows(src.db);
    const dump = await dumpPgliteSql(src.pglite!);

    const dest = await connectPglite();
    handles.push(dest);
    await dest.pglite!.exec(dump);
    // pg_dump clears search_path for the session that loads it; psql gets its own session.
    await dest.pglite!.exec("set search_path to public");
    expect(diffCounts(before, await countRows(dest.db))).toEqual([]);
    expect(before.users).toBe(1);
  });

  it("a PGlite SQL dump restores into a role-less instance with the same grants and policies", async () => {
    const src = await migrated();
    const dump = await dumpPgliteSql(src.pglite!);
    const dest = await connectPglite();
    handles.push(dest);
    const roles = await securityState(dest.db);
    expect(roles.roles).toEqual([]);
    await dest.pglite!.exec(dump);
    await dest.pglite!.exec("set search_path to public");
    const before = await securityState(src.db);
    expect(before.tableGrants.length).toBeGreaterThan(0);
    expect(before.columnGrants).toEqual(["email", "id", "name"]);
    expect(await securityState(dest.db)).toEqual(before);
  });

  it("refuses to restore when tenant roles are missing and cannot be created", async () => {
    await expect(
      assertTenantRolesCreatable(async () => ({ missing: ["ros_runtime"], canCreateRoles: false })),
    ).rejects.toThrow(
      "Create roles ros_tenant/ros_runtime (and GRANT ros_tenant TO ros_runtime) as an admin first, or restore with a user that has CREATEROLE.",
    );
    await expect(
      assertTenantRolesCreatable(async () => ({ missing: ["ros_tenant"], canCreateRoles: false })),
    ).rejects.toBeInstanceOf(TenantRolesError);
    await expect(
      assertTenantRolesCreatable(async () => ({ missing: ["ros_tenant"], canCreateRoles: true })),
    ).resolves.toBeUndefined();
    await expect(
      assertTenantRolesCreatable(async () => ({ missing: [], canCreateRoles: false })),
    ).resolves.toBeUndefined();
  });

  it("treats an existing drizzle schema as a non-empty target", async () => {
    const h = await connectPglite();
    handles.push(h);
    await h.db.execute(sql`create schema drizzle`);
    await expect(assertEmptyTarget(h.db)).rejects.toBeInstanceOf(NonEmptyTargetError);
  });

  it("never opens the original persistent dir; dumps the snapshot copy", async () => {
    const calls: string[] = [];
    const deps: DumpPgliteDeps = {
      snapshot: (async (dir: string) => {
        calls.push(`snapshot:${dir}`);
        return { dest: "/snap/copy", manifest: {}, totalRows: 0 };
      }) as unknown as DumpPgliteDeps["snapshot"],
      open: (async (dir: string) => {
        calls.push(`open:${dir}`);
        return { db: {}, pglite: {}, close: async () => void calls.push(`close:${dir}`) };
      }) as unknown as DumpPgliteDeps["open"],
      count: async () => ({ users: 1 }),
      dump: async () => "-- sql",
    };
    const out = await dumpPgliteDir("/data/pglite", deps);
    expect(out).toEqual({ sql: "-- sql", counts: { users: 1 } });
    expect(calls).toEqual(["snapshot:/data/pglite", "open:/snap/copy", "close:/snap/copy"]);
  });

  it("opens an in-memory dir directly without a snapshot", async () => {
    const calls: string[] = [];
    const deps = {
      snapshot: (async () => void calls.push("snapshot")) as unknown as DumpPgliteDeps["snapshot"],
      open: (async (dir?: string) => {
        calls.push(`open:${dir}`);
        return { db: {}, pglite: {}, close: async () => {} };
      }) as unknown as DumpPgliteDeps["open"],
      count: async () => ({}),
      dump: async () => "",
    };
    await dumpPgliteDir("memory://", deps);
    expect(calls).toEqual(["open:memory://"]);
  });

  it("resolvePostgresUrl uses DATABASE_URL, the dev default, or fails for non-postgres URLs", () => {
    expect(resolvePostgresUrl({ DATABASE_URL: "postgres://u:p@h/db" })).toBe("postgres://u:p@h/db");
    expect(resolvePostgresUrl({})).toContain("restaurantos_dev");
    expect(() => resolvePostgresUrl({ DATABASE_URL: "mysql://x" })).toThrow(/DATABASE_URL/);
  });

  it("spawnToFile rejects when the output cannot be written", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dbt-"));
    await expect(
      spawnToFile("sh", ["-c", "echo hi"], path.join(dir, "missing", "out.dump")),
    ).rejects.toThrow();
    const ok = path.join(dir, "out.txt");
    await spawnToFile("sh", ["-c", "echo hi"], ok);
    expect(await readFile(ok, "utf8")).toBe("hi\n");
    await expect(spawnToFile("sh", ["-c", "exit 3"], path.join(dir, "x"))).rejects.toThrow(/3/);
  });

  it("spawnFromFile rejects when the input is missing or the process fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "dbt-"));
    await expect(spawnFromFile("cat", [], path.join(dir, "nope"))).rejects.toThrow();
    const f = path.join(dir, "in.txt");
    await writeFile(f, "data");
    await expect(spawnFromFile("sh", ["-c", "cat >/dev/null"], f)).resolves.toBeUndefined();
    await expect(spawnFromFile("sh", ["-c", "exit 4"], f)).rejects.toThrow();
  });
});
