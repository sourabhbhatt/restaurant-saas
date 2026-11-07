import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  connectPglite,
  connectPostgres,
  runMigrations,
  type Executor,
} from "@ros/database/providers/postgres/client";
import {
  dumpPgliteSql,
  tenantRoleStatus,
  type Manifest,
} from "@ros/database/providers/postgres/db-tools";
import { countRows } from "@ros/database/providers/postgres/row-counts";

/**
 * End-to-end dump → restore against real PostgreSQL 18 (role/grant behaviour PGlite cannot
 * reproduce). Opt-in: PG_TEST_URL is a superuser URL of a throwaway server (Docker
 * `postgres:18`); PG_DOCKER_CONTAINER runs pg_dump/pg_restore from that image. Creates and
 * drops its own databases and the tenant roles, so never point it at a shared server.
 */
const ADMIN_URL = process.env.PG_TEST_URL;
const run = promisify(execFile);

function dbUrl(name: string, user?: { name: string; password: string }): string {
  const u = new URL(ADMIN_URL!);
  u.pathname = `/${name}`;
  if (user) {
    u.username = user.name;
    u.password = user.password;
  }
  return u.toString();
}

/** What a restore must leave behind for the app to run as `user` against `url`. */
async function restoredState(url: string, user: string) {
  const target = await connectPostgres(url, 1);
  try {
    const [check] = await rows<{
      tables: number;
      foreign_owned: number;
      sessions: boolean;
      name: boolean;
      password: boolean;
      member: boolean;
      can_set_role: boolean;
      policies: number;
      defacl_roles: string[];
    }>(
      target.db,
      sql`select (select count(*)::int from pg_tables where schemaname = 'public') as tables,
                 (select count(*)::int from pg_tables where schemaname = 'public' and tableowner <> ${user}) as foreign_owned,
                 has_table_privilege('ros_tenant', 'sessions', 'SELECT') as sessions,
                 has_column_privilege('ros_tenant', 'users', 'name', 'SELECT') as name,
                 has_column_privilege('ros_tenant', 'users', 'password_hash', 'SELECT') as password,
                 pg_has_role('ros_runtime', 'ros_tenant', 'MEMBER') as member,
                 pg_has_role(${user}, 'ros_tenant', 'SET') as can_set_role,
                 (select count(*)::int from pg_policies where schemaname = 'public') as policies,
                 (select coalesce(array_agg(distinct defaclrole::regrole::text), '{}') from pg_default_acl) as defacl_roles`,
    );
    const columns = await rows<{ column_name: string }>(
      target.db,
      sql`select column_name from information_schema.column_privileges
          where grantee = 'ros_tenant' and table_name = 'users' and privilege_type = 'SELECT'
          order by 1`,
    );
    // The tenant runner's first statement: must work for the connection user.
    const [who] = await target.db.transaction(async (tx) => {
      await tx.execute(sql`set local role ros_tenant`);
      return rows<{ me: string }>(tx as unknown as Executor, sql`select current_user as me`);
    });
    // Default privileges follow the restoring user: later migrations get the tenant grants.
    await target.db.execute(sql`create table f3_probe (id int)`);
    await target.db.execute(sql`create sequence f3_probe_seq`);
    const [auto] = await rows<{ table_dml: boolean; seq: boolean; runtime: boolean }>(
      target.db,
      sql`select has_table_privilege('ros_tenant', 'f3_probe', 'SELECT,INSERT,UPDATE,DELETE') as table_dml,
                 has_sequence_privilege('ros_tenant', 'f3_probe_seq', 'USAGE,SELECT') as seq,
                 has_table_privilege('ros_runtime', 'f3_probe', 'SELECT,INSERT,UPDATE,DELETE') as runtime`,
    );
    return {
      ...check!,
      columns: columns.map((c) => c.column_name),
      tenantRole: who!.me,
      autoGrants: auto!,
    };
  } finally {
    await target.close();
  }
}

async function rows<T>(db: Executor, query: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(query)) as unknown as { rows: T[] }).rows;
}

/** The db CLIs live in the database package; run them from there. */
const DATABASE_PACKAGE = path.resolve(import.meta.dirname, "../../../../packages/database");

async function script(name: string, args: string[], env: Record<string, string>) {
  return run("pnpm", ["exec", "tsx", `scripts/${name}.ts`, ...args], {
    cwd: DATABASE_PACKAGE,
    env: { ...process.env, ...env },
  });
}

describe.skipIf(!ADMIN_URL)("db:dump → db:restore on PostgreSQL", () => {
  it("restores tenant privileges, policies and role membership into a cluster without the roles", async () => {
    const suffix = Date.now().toString(36);
    const src = `ros_src_${suffix}`;
    const dst = `ros_dst_${suffix}`;
    const admin = await connectPostgres(ADMIN_URL!, 1);
    const dropRoles = sql.raw("drop role if exists ros_runtime, ros_tenant");
    try {
      await admin.db.execute(dropRoles);
      await admin.db.execute(sql.raw(`create database ${src}`));
      await admin.db.execute(sql.raw(`create database ${dst}`));

      const source = await connectPostgres(dbUrl(src), 1);
      let sourcePolicies: number;
      try {
        await runMigrations(source, "postgres");
        const [row] = await rows<{ n: number }>(
          source.db,
          sql`select count(*)::int as n from pg_policies where schemaname = 'public'`,
        );
        sourcePolicies = row!.n;
      } finally {
        await source.close();
      }
      const out = path.join(await mkdtemp(path.join(os.tmpdir(), "ros-dump-")), "db.pgc");
      await script("db-dump", ["--out", out], {
        DATABASE_PROVIDER: "postgres",
        DATABASE_URL: dbUrl(src),
      });

      // A fresh cluster as far as the tenant roles go: no database references them any more.
      await admin.db.execute(sql.raw(`drop database ${src} with (force)`));
      await admin.db.execute(dropRoles);
      expect(
        await rows(admin.db, sql`select 1 from pg_roles where rolname like 'ros\\_%'`),
      ).toEqual([]);

      await script("db-restore", ["--in", out, "--target-url", dbUrl(dst)], {});

      const target = await connectPostgres(dbUrl(dst), 1);
      try {
        const [check] = await rows<{
          sessions: boolean;
          name: boolean;
          password: boolean;
          member: boolean;
          policies: number;
        }>(
          target.db,
          sql`select has_table_privilege('ros_tenant', 'sessions', 'SELECT') as sessions,
                     has_column_privilege('ros_tenant', 'users', 'name', 'SELECT') as name,
                     has_column_privilege('ros_tenant', 'users', 'password_hash', 'SELECT') as password,
                     pg_has_role('ros_runtime', 'ros_tenant', 'MEMBER') as member,
                     (select count(*)::int from pg_policies where schemaname = 'public') as policies`,
        );
        expect(check).toEqual({
          sessions: false,
          name: true,
          password: false,
          member: true,
          policies: sourcePolicies,
        });
        const columns = await rows<{ column_name: string }>(
          target.db,
          sql`select column_name from information_schema.column_privileges
              where grantee = 'ros_tenant' and table_name = 'users' and privilege_type = 'SELECT'
              order by 1`,
        );
        expect(columns.map((c) => c.column_name)).toEqual(["email", "id", "name"]);
      } finally {
        await target.close();
      }
    } finally {
      await admin.db.execute(sql.raw(`drop database if exists ${src} with (force)`));
      await admin.db.execute(sql.raw(`drop database if exists ${dst} with (force)`));
      await admin.db.execute(dropRoles);
      await admin.close();
    }
  }, 180_000);
});

/**
 * The Cloud SQL path: the restoring user is a non-superuser with CREATEROLE (`restorer`),
 * not the dump's owner (`postgres`). Ownership, grants, policies and default privileges
 * must all end up with `restorer`, and `restorer` must be able to SET ROLE ros_tenant.
 */
describe.skipIf(!ADMIN_URL)("db:restore as a different, non-superuser user", () => {
  const RESTORER = { name: "restorer", password: "restorer-pw" };
  const dropRoles = sql.raw("drop role if exists ros_runtime, ros_tenant");

  async function withCluster(
    work: (admin: Executor, suffix: string) => Promise<void>,
    extraCleanup: (admin: Executor) => Promise<void> = async () => {},
  ) {
    const suffix = Date.now().toString(36);
    const admin = await connectPostgres(ADMIN_URL!, 1);
    try {
      await admin.db.execute(dropRoles);
      await admin.db.execute(sql.raw(`drop role if exists ${RESTORER.name}`));
      await admin.db.execute(
        sql.raw(`create role ${RESTORER.name} login createrole password '${RESTORER.password}'`),
      );
      await work(admin.db, suffix);
    } finally {
      await extraCleanup(admin.db);
      await admin.db.execute(dropRoles);
      await admin.db.execute(sql.raw(`drop role if exists ${RESTORER.name}`));
      await admin.close();
    }
  }

  it("custom-format dump taken as postgres restores as restorer with the same security state", async () => {
    let src = "";
    let dst = "";
    await withCluster(
      async (admin, suffix) => {
        src = `ros_src_${suffix}`;
        dst = `ros_dst_${suffix}`;
        await admin.execute(sql.raw(`create database ${src}`));
        await admin.execute(sql.raw(`create database ${dst} owner ${RESTORER.name}`));

        const source = await connectPostgres(dbUrl(src), 1);
        let expected: { policies: number; tables: number };
        try {
          await runMigrations(source, "postgres");
          const [row] = await rows<{ policies: number; tables: number }>(
            source.db,
            sql`select (select count(*)::int from pg_policies where schemaname = 'public') as policies,
                       (select count(*)::int from pg_tables where schemaname = 'public') as tables`,
          );
          expected = row!;
        } finally {
          await source.close();
        }
        const out = path.join(await mkdtemp(path.join(os.tmpdir(), "ros-dump-")), "db.pgc");
        await script("db-dump", ["--out", out], {
          DATABASE_PROVIDER: "postgres",
          DATABASE_URL: dbUrl(src),
        });
        // Fresh cluster as far as the tenant roles go; restorer creates them (and so holds ADMIN).
        await admin.execute(sql.raw(`drop database ${src} with (force)`));
        await admin.execute(dropRoles);

        const targetUrl = dbUrl(dst, RESTORER);
        await script("db-restore", ["--in", out, "--target-url", targetUrl], {});

        const state = await restoredState(targetUrl, RESTORER.name);
        expect(state).toEqual({
          tables: expected.tables,
          foreign_owned: 0,
          sessions: false,
          name: true,
          password: false,
          member: true,
          can_set_role: true,
          policies: expected.policies,
          defacl_roles: [RESTORER.name],
          columns: ["email", "id", "name"],
          tenantRole: "ros_tenant",
          autoGrants: { table_dml: true, seq: true, runtime: true },
        });
        // Row counts match the manifest (the probe table is not in it).
        await expect(
          script(
            "db-verify",
            ["--manifest", `${out}.manifest.json`, "--target-url", targetUrl],
            {},
          ),
        ).resolves.toMatchObject({ stdout: expect.stringContaining('"msg":"verify_ok"') });
      },
      async (admin) => {
        await admin.execute(sql.raw(`drop database if exists ${src} with (force)`));
        await admin.execute(sql.raw(`drop database if exists ${dst} with (force)`));
      },
    );
  }, 240_000);

  it("PGlite plain-SQL dump restores as restorer; a second user without ADMIN on ros_tenant is refused before any write", async () => {
    let dst = "";
    let dst2 = "";
    await withCluster(
      async (admin, suffix) => {
        dst = `ros_dst_${suffix}`;
        dst2 = `ros_dst2_${suffix}`;
        await admin.execute(sql.raw(`create database ${dst} owner ${RESTORER.name}`));
        await admin.execute(dropRoles);

        const pglite = await connectPglite();
        let expected: { policies: number; tables: number };
        let dump: string;
        let counts: Manifest["counts"];
        try {
          await runMigrations(pglite, "pglite");
          await pglite.db.execute(
            sql`insert into users (email, name) values ('a@example.com', 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO ros_tenant;')`,
          );
          const [row] = await rows<{ policies: number; tables: number }>(
            pglite.db,
            sql`select (select count(*)::int from pg_policies where schemaname = 'public') as policies,
                       (select count(*)::int from pg_tables where schemaname = 'public') as tables`,
          );
          expected = row!;
          counts = await countRows(pglite.db);
          dump = await dumpPgliteSql(pglite.pglite!);
        } finally {
          await pglite.close();
        }
        const out = path.join(await mkdtemp(path.join(os.tmpdir(), "ros-dump-")), "db.sql");
        await writeFile(out, dump);
        const manifest: Manifest = {
          createdAt: new Date().toISOString(),
          provider: "pglite",
          counts,
        };
        await writeFile(`${out}.manifest.json`, JSON.stringify(manifest));

        const targetUrl = dbUrl(dst, RESTORER);
        await script("db-restore", ["--in", out, "--target-url", targetUrl], {});
        const state = await restoredState(targetUrl, RESTORER.name);
        expect(state).toMatchObject({
          tables: expected.tables,
          foreign_owned: 0,
          sessions: false,
          password: false,
          can_set_role: true,
          policies: expected.policies,
          defacl_roles: [RESTORER.name],
          columns: ["email", "id", "name"],
          tenantRole: "ros_tenant",
          autoGrants: { table_dml: true, seq: true, runtime: true },
        });
        const target = await connectPostgres(targetUrl, 1);
        try {
          expect(await rows(target.db, sql`select name from users`)).toEqual([
            {
              name: "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO ros_tenant;",
            },
          ]);
        } finally {
          await target.close();
        }
        await expect(
          script(
            "db-verify",
            ["--manifest", `${out}.manifest.json`, "--target-url", targetUrl],
            {},
          ),
        ).resolves.toMatchObject({ stdout: expect.stringContaining('"msg":"verify_ok"') });

        // The roles now exist (restorer holds ADMIN). Another CREATEROLE user does not.
        await admin.execute(sql.raw(`drop role if exists restorer2`));
        await admin.execute(sql.raw(`create role restorer2 login createrole password 'pw2'`));
        await admin.execute(sql.raw(`create database ${dst2} owner restorer2`));
        const other = { name: "restorer2", password: "pw2" };
        const otherDb = await connectPostgres(dbUrl(dst2, other), 1);
        try {
          expect(await tenantRoleStatus(otherDb.db)).toEqual({
            missing: [],
            canCreateRoles: true,
            grantsNeeded: ["ros_tenant TO restorer2"],
            canGrantTenant: false,
          });
        } finally {
          await otherDb.close();
        }
        const refused = script("db-restore", ["--in", out, "--target-url", dbUrl(dst2, other)], {});
        await expect(refused).rejects.toMatchObject({
          code: 3,
          stderr: expect.stringContaining("lacks the ADMIN option on it"),
        });
        const untouched = await connectPostgres(dbUrl(dst2, other), 1);
        try {
          expect(
            await rows(untouched.db, sql`select 1 from pg_tables where schemaname = 'public'`),
          ).toEqual([]);
        } finally {
          await untouched.close();
        }
      },
      async (admin) => {
        await admin.execute(sql.raw(`drop database if exists ${dst} with (force)`));
        await admin.execute(sql.raw(`drop database if exists ${dst2} with (force)`));
        await admin.execute(sql.raw(`drop role if exists restorer2`));
      },
    );
  }, 240_000);
});
