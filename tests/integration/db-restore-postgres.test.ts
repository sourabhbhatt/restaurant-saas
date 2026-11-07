import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  connectPostgres,
  runMigrations,
  type Executor,
} from "@/infrastructure/database/providers/postgres/client";

/**
 * End-to-end dump → restore against real PostgreSQL 18 (role/grant behaviour PGlite cannot
 * reproduce). Opt-in: PG_TEST_URL is a superuser URL of a throwaway server (Docker
 * `postgres:18`); PG_DOCKER_CONTAINER runs pg_dump/pg_restore from that image. Creates and
 * drops its own databases and the tenant roles, so never point it at a shared server.
 */
const ADMIN_URL = process.env.PG_TEST_URL;
const run = promisify(execFile);

function dbUrl(name: string): string {
  const u = new URL(ADMIN_URL!);
  u.pathname = `/${name}`;
  return u.toString();
}

async function rows<T>(db: Executor, query: ReturnType<typeof sql>): Promise<T[]> {
  return ((await db.execute(query)) as unknown as { rows: T[] }).rows;
}

async function script(name: string, args: string[], env: Record<string, string>) {
  return run("pnpm", ["exec", "tsx", `scripts/${name}.ts`, ...args], {
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
