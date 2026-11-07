import { readFile } from "node:fs/promises";
import path from "node:path";

import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbContext } from "@/infrastructure/database/interfaces/transaction";
import {
  connectPglite,
  createTenantRunner,
  MIGRATIONS_DIR,
  runMigrations,
  type Executor,
} from "@/infrastructure/database/providers/postgres/client";
import { TENANT_TABLES } from "@/infrastructure/database/providers/postgres/tenant-tables";
import type { Container } from "@/server/container";
import { addStaffMember } from "@/test/fixtures";
import { createTenantWorld, type TenantWorld } from "@/test/fixtures-rls";
import { createTestContainer } from "@/test/harness";

let c: Container;
let a: TenantWorld;
let b: TenantWorld;

beforeAll(async () => {
  c = await createTestContainer();
  a = await createTenantWorld(c, "Rls A");
  b = await createTenantWorld(c, "Rls B");
  // The same staff user also belongs to B, for the user-bound membership checks.
  await addStaffMember(c, {
    workspaceId: b.workspaceId,
    userId: a.staff.userId,
    role: "workspace_member",
  });
});

afterAll(() => c.close());

async function rows<T>(e: Executor, query: SQL): Promise<T[]> {
  return ((await e.execute(query)) as unknown as { rows: T[] }).rows;
}

function asTenant<T>(context: DbContext, work: (e: Executor) => Promise<T>): Promise<T> {
  return createTenantRunner(c.db, (e) => e, { role: "ros_tenant", context: () => context }).run(
    work,
  );
}

const countIn = (table: string, workspaceId: string) =>
  sql`select count(*)::int as n from ${sql.identifier(table)} where workspace_id = ${workspaceId}`;

async function n(e: Executor, query: SQL): Promise<number> {
  const [row] = await rows<{ n: number }>(e, query);
  return row!.n;
}

function pgCode(error: unknown): string | undefined {
  for (let e: unknown = error; e && typeof e === "object"; e = (e as { cause?: unknown }).cause) {
    if ("code" in e && typeof (e as { code: unknown }).code === "string")
      return (e as { code: string }).code;
  }
  return undefined;
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return pgCode(error);
  }
  return "no error";
}

describe("row-level security schema", () => {
  it("every table with a workspace_id column has RLS enabled and both policies", async () => {
    const tables = await rows<{ table_name: string; rls: boolean }>(
      c.db,
      sql`select col.table_name, cls.relrowsecurity as rls
          from information_schema.columns col
          join information_schema.tables t
            on t.table_schema = col.table_schema and t.table_name = col.table_name
          join pg_class cls on cls.relname = col.table_name
          join pg_namespace ns on ns.oid = cls.relnamespace and ns.nspname = col.table_schema
          where col.table_schema = 'public' and col.column_name = 'workspace_id'
            and t.table_type = 'BASE TABLE'
          order by col.table_name`,
    );
    expect(tables.map((t) => t.table_name)).toEqual([...TENANT_TABLES].sort());
    expect(tables.filter((t) => !t.rls).map((t) => t.table_name)).toEqual([]);

    const policies = await rows<{ tablename: string; policyname: string; roles: string }>(
      c.db,
      sql`select tablename, policyname, roles::text as roles from pg_policies where schemaname = 'public'`,
    );
    for (const table of TENANT_TABLES) {
      const mine = policies.filter((p) => p.tablename === table);
      expect(mine.find((p) => p.policyname === "tenant_isolation")?.roles, table).toBe(
        "{ros_tenant}",
      );
      expect(mine.find((p) => p.policyname === "runtime_access")?.roles, table).toBe(
        "{ros_runtime}",
      );
    }
  });

  it("the fixtures put rows for both workspaces in every tenant table", async () => {
    for (const table of TENANT_TABLES) {
      expect(await n(c.db, countIn(table, a.workspaceId)), `${table} A`).toBeGreaterThan(0);
      expect(await n(c.db, countIn(table, b.workspaceId)), `${table} B`).toBeGreaterThan(0);
    }
  });
});

describe("tenant isolation", () => {
  it.each(TENANT_TABLES)("tenant context A sees zero rows of B in %s", async (table) => {
    const ctx = { workspaceId: a.workspaceId, userId: a.owner.userId };
    const [own, foreign, all] = await asTenant(ctx, async (e) => [
      await n(e, countIn(table, a.workspaceId)),
      await n(e, countIn(table, b.workspaceId)),
      await n(
        e,
        sql`select count(*)::int as n from ${sql.identifier(table)} where workspace_id <> ${a.workspaceId}`,
      ),
    ]);
    expect(own).toBeGreaterThan(0);
    expect(foreign).toBe(0);
    expect(all).toBe(0);
  });

  it("insert with B's workspace_id under A's context fails with 42501", async () => {
    const ctx = { workspaceId: a.workspaceId, userId: a.owner.userId };
    expect(
      await codeOf(
        asTenant(ctx, (e) =>
          e.execute(
            sql`insert into workspace_entitlements (workspace_id, key, value) values (${b.workspaceId}, 'maxBranches', '3')`,
          ),
        ),
      ),
    ).toBe("42501");
    // Moving an own row into B is refused too (WITH CHECK).
    expect(
      await codeOf(
        asTenant(ctx, (e) =>
          e.execute(
            sql`update stored_files set workspace_id = ${b.workspaceId} where workspace_id = ${a.workspaceId}`,
          ),
        ),
      ),
    ).toBe("42501");
  });

  it("tenant context cannot read sessions (42501)", async () => {
    const ctx = { workspaceId: a.workspaceId, userId: a.owner.userId };
    for (const table of [
      "sessions",
      "auth_tokens",
      "rate_limit_buckets",
      "idempotency_records",
      "email_outbox",
    ]) {
      expect(
        await codeOf(
          asTenant(ctx, (e) => e.execute(sql`select 1 from ${sql.identifier(table)} limit 1`)),
        ),
        table,
      ).toBe("42501");
    }
  });

  it("user-bound context sees own memberships across workspaces and nobody else's", async () => {
    const userOnly = await asTenant({ workspaceId: null, userId: a.staff.userId }, (e) =>
      rows<{ user_id: string; workspace_id: string }>(
        e,
        sql`select user_id, workspace_id from workspace_memberships`,
      ),
    );
    expect(new Set(userOnly.map((m) => m.user_id))).toEqual(new Set([a.staff.userId]));
    expect(new Set(userOnly.map((m) => m.workspace_id))).toEqual(
      new Set([a.workspaceId, b.workspaceId]),
    );

    const notes = await asTenant({ workspaceId: null, userId: a.staff.userId }, (e) =>
      rows<{ user_id: string }>(e, sql`select user_id from notifications`),
    );
    expect(notes.length).toBeGreaterThan(0);
    expect(new Set(notes.map((x) => x.user_id))).toEqual(new Set([a.staff.userId]));

    const stranger = await asTenant({ workspaceId: null, userId: b.owner.userId }, (e) =>
      n(
        e,
        sql`select count(*)::int as n from workspace_memberships where user_id <> ${b.owner.userId}`,
      ),
    );
    expect(stranger).toBe(0);
  });

  it("system roles are readable in tenant context, not writable", async () => {
    const ctx = { workspaceId: a.workspaceId, userId: a.owner.userId };
    const visible = await asTenant(ctx, (e) =>
      rows<{ workspace_id: string | null }>(e, sql`select workspace_id from roles`),
    );
    expect(visible.some((r) => r.workspace_id === null)).toBe(true);
    expect(visible.some((r) => r.workspace_id === a.workspaceId)).toBe(true);
    expect(visible.some((r) => r.workspace_id === b.workspaceId)).toBe(false);

    const updated = await asTenant(ctx, (e) =>
      rows<{ id: string }>(
        e,
        sql`update roles set name = 'Hijacked' where workspace_id is null returning id`,
      ),
    );
    expect(updated).toEqual([]);
    const deleted = await asTenant(ctx, (e) =>
      rows<{ id: string }>(e, sql`delete from roles where workspace_id is null returning id`),
    );
    expect(deleted).toEqual([]);
    expect(
      await codeOf(
        asTenant(ctx, (e) =>
          e.execute(sql`insert into roles (key, name, scope) values ('evil', 'Evil', 'WORKSPACE')`),
        ),
      ),
    ).toBe("42501");
  });
});

describe("tenant_rls migration", () => {
  it("re-runs cleanly and the down script reverts it", async () => {
    const handle = await connectPglite();
    try {
      await runMigrations(handle, "pglite");
      const up = await readFile(path.join(MIGRATIONS_DIR, "0002_tenant_rls.sql"), "utf8");
      for (const statement of up.split("--> statement-breakpoint"))
        await handle.db.execute(sql.raw(statement));
      const enabled = () =>
        n(
          handle.db,
          sql`select count(*)::int as n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
              where ns.nspname = 'public' and c.relrowsecurity`,
        );
      expect(await enabled()).toBe(TENANT_TABLES.length);

      const down = await readFile(
        path.join(MIGRATIONS_DIR, "../migrations-down/0002_tenant_rls.down.sql"),
        "utf8",
      );
      const statements = down.split("\n").filter((line) => line.trim() && !line.startsWith("--"));
      for (const statement of statements) await handle.db.execute(sql.raw(statement));
      expect(await enabled()).toBe(0);
      expect(
        await n(
          handle.db,
          sql`select count(*)::int as n from pg_policies where schemaname = 'public'`,
        ),
      ).toBe(0);
    } finally {
      await handle.close();
    }
  });
});
