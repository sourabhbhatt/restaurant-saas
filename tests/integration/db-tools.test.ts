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
  rebindDefaultPrivileges,
  resolvePostgresUrl,
  spawnFromFile,
  spawnToFile,
  splitRestoreToc,
  TenantRoleAdminError,
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
    const ok = { grantsNeeded: [], canGrantTenant: true };
    await expect(
      assertTenantRolesCreatable(async () => ({
        missing: ["ros_runtime"],
        canCreateRoles: false,
        ...ok,
      })),
    ).rejects.toThrow(
      "Create roles ros_tenant/ros_runtime (and GRANT ros_tenant TO ros_runtime) as an admin first, or restore with a user that has CREATEROLE.",
    );
    await expect(
      assertTenantRolesCreatable(async () => ({
        missing: ["ros_tenant"],
        canCreateRoles: false,
        ...ok,
      })),
    ).rejects.toBeInstanceOf(TenantRolesError);
    await expect(
      assertTenantRolesCreatable(async () => ({
        missing: ["ros_tenant"],
        canCreateRoles: true,
        ...ok,
      })),
    ).resolves.toBeUndefined();
    await expect(
      assertTenantRolesCreatable(async () => ({ missing: [], canCreateRoles: false, ...ok })),
    ).resolves.toBeUndefined();
  });

  it("refuses to restore when the roles exist but the user cannot grant ros_tenant membership", async () => {
    // Roles pre-created by someone else: the guarded GRANTs would fail mid-transaction.
    const status = {
      missing: [],
      canCreateRoles: true,
      grantsNeeded: ["ros_tenant TO ros_runtime", "ros_tenant TO restorer"],
      canGrantTenant: false,
    };
    const failure = assertTenantRolesCreatable(async () => status);
    await expect(failure).rejects.toBeInstanceOf(TenantRoleAdminError);
    await expect(failure).rejects.toThrow(
      'Role ros_tenant exists but the restoring user lacks the ADMIN option on it, so "GRANT ros_tenant TO ros_runtime", "GRANT ros_tenant TO restorer" would fail. As an admin run: GRANT ros_tenant TO ros_runtime; GRANT ros_tenant TO restorer; (or GRANT ros_tenant TO <restoring user> WITH ADMIN OPTION).',
    );
    // Nothing to grant: no ADMIN needed.
    await expect(
      assertTenantRolesCreatable(async () => ({ ...status, grantsNeeded: [] })),
    ).resolves.toBeUndefined();
    // ros_tenant itself is missing: creating it confers ADMIN, so the grants will work.
    await expect(
      assertTenantRolesCreatable(async () => ({ ...status, missing: ["ros_tenant"] })),
    ).resolves.toBeUndefined();
    // Superuser or ADMIN holder.
    await expect(
      assertTenantRolesCreatable(async () => ({ ...status, canGrantTenant: true })),
    ).resolves.toBeUndefined();
  });

  describe("rebindDefaultPrivileges", () => {
    const trigger =
      "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,USAGE ON SEQUENCES TO ros_tenant;";

    it("drops FOR ROLE <dump owner> from ALTER DEFAULT PRIVILEGES statements at line start", () => {
      const out = rebindDefaultPrivileges(
        [
          trigger,
          'ALTER DEFAULT PRIVILEGES FOR ROLE "Mixed-Case" IN SCHEMA public GRANT SELECT ON TABLES TO ros_runtime;',
          "ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT SELECT ON TABLES TO ros_tenant;",
          "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ros_tenant;",
          "GRANT SELECT ON TABLE public.users TO ros_tenant;",
        ].join("\n"),
      );
      expect(out).toBe(
        [
          "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,USAGE ON SEQUENCES TO ros_tenant;",
          "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ros_runtime;",
          "ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO ros_tenant;",
          "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ros_tenant;",
          "GRANT SELECT ON TABLE public.users TO ros_tenant;",
        ].join("\n"),
      );
    });

    it("never touches COPY data, even a row that is exactly the statement", () => {
      const dump = [
        "COPY public.notes (body) FROM stdin;",
        trigger,
        `  ${trigger}`,
        "\\.",
        "",
        trigger,
        "COPY public.other (body) FROM stdin;",
        trigger,
        "\\.",
      ].join("\n");
      const out = rebindDefaultPrivileges(dump);
      const lines = out.split("\n");
      expect(lines[1]).toBe(trigger);
      expect(lines[2]).toBe(`  ${trigger}`);
      expect(lines[5]).toBe(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,USAGE ON SEQUENCES TO ros_tenant;",
      );
      expect(lines[7]).toBe(trigger);
      expect(out.endsWith("\\.")).toBe(true);
    });

    it("keeps CRLF line endings and a trailing newline intact", () => {
      expect(rebindDefaultPrivileges(`${trigger}\r\n`)).toBe(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,USAGE ON SEQUENCES TO ros_tenant;\r\n",
      );
      expect(rebindDefaultPrivileges("")).toBe("");
    });
  });

  describe("splitRestoreToc", () => {
    const toc = [
      ";",
      "; Archive created at 2026-11-07 14:58:58 UTC",
      ";     Format: CUSTOM",
      ";",
      "; Selected TOC Entries:",
      ";",
      "217; 1259 16400 TABLE public users postgres",
      "4394; 0 0 ACL public TABLE addon_groups postgres",
      "2268; 826 18203 DEFAULT ACL public DEFAULT PRIVILEGES FOR SEQUENCES postgres",
      "2267; 826 18202 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES postgres",
      "",
    ].join("\n");

    it("comments DEFAULT ACL entries out of the main list and keeps them in the replay list", () => {
      const split = splitRestoreToc(toc);
      expect(split.defaultAcl).toEqual([
        "2268; 826 18203 DEFAULT ACL public DEFAULT PRIVILEGES FOR SEQUENCES postgres",
        "2267; 826 18202 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES postgres",
      ]);
      expect(split.main).toContain("217; 1259 16400 TABLE public users postgres\n");
      expect(split.main).toContain("4394; 0 0 ACL public TABLE addon_groups postgres\n");
      expect(split.main).toContain(";2268; 826 18203 DEFAULT ACL public");
      expect(split.main).toContain(";2267; 826 18202 DEFAULT ACL public");
      expect(split.main).not.toMatch(/^2267;/m);
      expect(split.replay).toBe(
        "2268; 826 18203 DEFAULT ACL public DEFAULT PRIVILEGES FOR SEQUENCES postgres\n2267; 826 18202 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES postgres\n",
      );
    });

    it("reports a dump without default privileges", () => {
      const split = splitRestoreToc("217; 1259 16400 TABLE public users postgres\n");
      expect(split.defaultAcl).toEqual([]);
      expect(split.replay).toBe("");
      expect(split.main).toBe("217; 1259 16400 TABLE public users postgres\n");
    });
  });

  it("a PGlite dump has no owner statements and its default privileges bind to the restoring user", async () => {
    const src = await migrated();
    const trigger =
      "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO ros_tenant;";
    // A text-first table so the row is a whole COPY line that starts with the statement.
    await src.db.execute(sql`create table f3_copy_probe (note text not null)`);
    await src.db.execute(sql`insert into f3_copy_probe (note) values (${trigger})`);
    const dump = await dumpPgliteSql(src.pglite!);

    expect(dump).not.toMatch(/OWNER TO/);
    // The only "FOR ROLE postgres" left is the data row (the trigger is the exact dump statement).
    expect(dump.match(/FOR ROLE postgres/g)).toHaveLength(1);
    expect(dump).toMatch(
      /^ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,DELETE,UPDATE ON TABLES TO ros_tenant;$/m,
    );
    expect(dump).toMatch(
      /^ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,USAGE ON SEQUENCES TO ros_runtime;$/m,
    );
    expect(dump.split(trigger).length - 1).toBe(1); // the data row, nothing else

    const dest = await connectPglite();
    handles.push(dest);
    await dest.pglite!.exec(dump);
    await dest.pglite!.exec("set search_path to public");
    const q = async <T>(query: ReturnType<typeof sql>) =>
      ((await dest.db.execute(query)) as unknown as { rows: T[] }).rows;
    expect(await q<{ note: string }>(sql`select note from f3_copy_probe`)).toEqual([
      { note: trigger },
    ]);
    const before = await securityState(src.db);
    expect(await securityState(dest.db)).toEqual(before);
    // Default privileges are now bound to whoever restored (here PGlite's postgres).
    expect(
      await q<{ role: string; n: number }>(
        sql`select defaclrole::regrole::text as role, count(*)::int as n from pg_default_acl group by 1`,
      ),
    ).toEqual([{ role: "postgres", n: 2 }]);
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
