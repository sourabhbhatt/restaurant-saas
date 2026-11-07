import { readFile } from "node:fs/promises";
import path from "node:path";

import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DbContext } from "@ros/database/interfaces/transaction";
import {
  connectPglite,
  createTenantRunner,
  MIGRATIONS_DIR,
  runMigrations,
  type Executor,
} from "@ros/database/providers/postgres/client";
import {
  ORGANIZATION_TABLES,
  PAYMENT_TABLES,
  TENANT_TABLES,
} from "@ros/database/providers/postgres/tenant-tables";
import type { Container } from "@/composition/container";
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
    for (const table of [...TENANT_TABLES, ...ORGANIZATION_TABLES, ...PAYMENT_TABLES]) {
      const mine = policies.filter((p) => p.tablename === table);
      expect(mine.find((p) => p.policyname === "tenant_isolation")?.roles, table).toBe(
        "{ros_tenant}",
      );
      expect(mine.find((p) => p.policyname === "runtime_access")?.roles, table).toBe(
        "{ros_runtime}",
      );
    }
  });

  it("organization tables have RLS enabled and tenant policies scoped by workspace or membership", async () => {
    const tables = await rows<{ relname: string; rls: boolean }>(
      c.db,
      sql`select c.relname, c.relrowsecurity as rls from pg_class c
          join pg_namespace ns on ns.oid = c.relnamespace
          where ns.nspname = 'public' and c.relname in ('organizations', 'organization_members')`,
    );
    expect(tables.map((t) => t.relname).sort()).toEqual([...ORGANIZATION_TABLES].sort());
    expect(tables.filter((t) => !t.rls)).toEqual([]);

    const policies = await rows<{
      tablename: string;
      cmd: string;
      qual: string | null;
      with_check: string | null;
    }>(
      c.db,
      sql`select tablename, cmd, qual, with_check from pg_policies
          where schemaname = 'public' and policyname = 'tenant_isolation'
            and tablename in ('organizations', 'organization_members')`,
    );
    const viaWorkspace =
      "( SELECT workspaces.organization_id\n   FROM workspaces\n  WHERE (workspaces.id = app_current_workspace()))";
    expect(policies.find((p) => p.tablename === "organizations")).toMatchObject({
      cmd: "ALL",
      qual: `((id = ${viaWorkspace}) OR (id IN ( SELECT organization_members.organization_id\n   FROM organization_members\n  WHERE (organization_members.user_id = app_current_user()))))`,
      with_check: `(id = ${viaWorkspace})`,
    });
    expect(policies.find((p) => p.tablename === "organization_members")).toMatchObject({
      cmd: "ALL",
      qual: `((organization_id = ${viaWorkspace}) OR (user_id = app_current_user()))`,
      with_check: `(organization_id = ${viaWorkspace})`,
    });
  });

  it("payment tables have RLS enabled, scoped by organization, read-only for tenants", async () => {
    const tables = await rows<{ relname: string; rls: boolean }>(
      c.db,
      sql`select c.relname, c.relrowsecurity as rls from pg_class c
          join pg_namespace ns on ns.oid = c.relnamespace
          where ns.nspname = 'public' and c.relname in ('payment_orders', 'payment_events')`,
    );
    expect(tables.map((t) => t.relname).sort()).toEqual([...PAYMENT_TABLES].sort());
    expect(tables.filter((t) => !t.rls)).toEqual([]);

    const policies = await rows<{
      tablename: string;
      cmd: string;
      qual: string | null;
      with_check: string | null;
    }>(
      c.db,
      sql`select tablename, cmd, qual, with_check from pg_policies
          where schemaname = 'public' and policyname = 'tenant_isolation'
            and tablename in ('payment_orders', 'payment_events')`,
    );
    const viaWorkspace =
      "( SELECT workspaces.organization_id\n   FROM workspaces\n  WHERE (workspaces.id = app_current_workspace()))";
    for (const table of PAYMENT_TABLES) {
      expect(
        policies.find((p) => p.tablename === table),
        table,
      ).toMatchObject({
        cmd: "ALL",
        qual: `((organization_id = ${viaWorkspace}) OR (organization_id IN ( SELECT organization_members.organization_id\n   FROM organization_members\n  WHERE (organization_members.user_id = app_current_user()))))`,
        with_check: `(organization_id = ${viaWorkspace})`,
      });
    }
  });

  it("organization and payment tables are read-only for tenants", async () => {
    for (const table of [...ORGANIZATION_TABLES, ...PAYMENT_TABLES]) {
      for (const privilege of ["INSERT", "UPDATE", "DELETE"]) {
        const [row] = await rows<{ ok: boolean }>(
          c.db,
          sql`select has_table_privilege('ros_tenant', ${table}, ${privilege}) as ok`,
        );
        expect(row!.ok, `${table} ${privilege}`).toBe(false);
      }
      const [row] = await rows<{ ok: boolean }>(
        c.db,
        sql`select has_table_privilege('ros_tenant', ${table}, 'SELECT') as ok`,
      );
      expect(row!.ok, `${table} SELECT`).toBe(true);
    }
  });

  it("tenant policies check the bound workspace on read and write; own rows are read-only", async () => {
    const policies = await rows<{
      tablename: string;
      policyname: string;
      cmd: string;
      qual: string | null;
      with_check: string | null;
    }>(
      c.db,
      sql`select tablename, policyname, cmd, qual, with_check from pg_policies
          where schemaname = 'public' and 'ros_tenant' = any(roles)`,
    );
    const ws = "(workspace_id = app_current_workspace())";
    for (const table of TENANT_TABLES) {
      const isolation = policies.find(
        (p) => p.tablename === table && p.policyname === "tenant_isolation",
      );
      expect(isolation, table).toMatchObject({ cmd: "ALL", qual: ws, with_check: ws });
    }
    const extras = policies
      .filter((p) => p.policyname !== "tenant_isolation")
      .map((p) => ({
        table: p.tablename,
        name: p.policyname,
        cmd: p.cmd,
        qual: p.qual,
        check: p.with_check,
      }))
      .sort((x, y) => x.table.localeCompare(y.table));
    expect(extras).toEqual([
      {
        table: "notifications",
        name: "tenant_own_rows",
        cmd: "SELECT",
        qual: "(user_id = app_current_user())",
        check: null,
      },
      {
        table: "roles",
        name: "tenant_system_roles",
        cmd: "SELECT",
        qual: "(workspace_id IS NULL)",
        check: null,
      },
      {
        table: "workspace_memberships",
        name: "tenant_own_rows",
        cmd: "SELECT",
        qual: "(user_id = app_current_user())",
        check: null,
      },
    ]);
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

  it("own rows in another workspace can be read but not deleted or moved", async () => {
    const u = a.staff.userId;
    await c.db.execute(
      sql`insert into notifications (user_id, workspace_id, type, title) values (${u}, ${b.workspaceId}, 'test', 'B note')`,
    );
    const ctx = { workspaceId: a.workspaceId, userId: u };
    for (const table of ["workspace_memberships", "notifications"]) {
      const t = sql.identifier(table);
      const seen = await asTenant(ctx, (e) =>
        n(
          e,
          sql`select count(*)::int as n from ${t} where user_id = ${u} and workspace_id = ${b.workspaceId}`,
        ),
      );
      expect(seen, `${table} select`).toBeGreaterThan(0);
      const deleted = await asTenant(ctx, (e) =>
        rows(
          e,
          sql`delete from ${t} where user_id = ${u} and workspace_id = ${b.workspaceId} returning id`,
        ),
      );
      expect(deleted, `${table} delete`).toEqual([]);
      const moved = await asTenant(ctx, (e) =>
        rows(
          e,
          sql`update ${t} set workspace_id = ${a.workspaceId} where user_id = ${u} and workspace_id = ${b.workspaceId} returning id`,
        ),
      ).catch((error: unknown) => pgCode(error));
      expect(
        moved === "42501" || (Array.isArray(moved) && moved.length === 0),
        `${table} update`,
      ).toBe(true);
      expect(
        await n(
          c.db,
          sql`select count(*)::int as n from ${t} where user_id = ${u} and workspace_id = ${b.workspaceId}`,
        ),
      ).toBe(seen);
    }
  });

  it("users exposes only id, name and email to tenant transactions", async () => {
    const ctx = { workspaceId: a.workspaceId, userId: a.owner.userId };
    const visible = await asTenant(ctx, (e) =>
      rows<{ email: string }>(
        e,
        sql`select id, name, email from users where id = ${a.owner.userId}`,
      ),
    );
    expect(visible).toHaveLength(1);
    for (const column of ["password_hash", "platform_role", "disabled_at", "email_verified_at"]) {
      expect(
        await codeOf(
          asTenant(ctx, (e) => e.execute(sql`select ${sql.identifier(column)} from users limit 1`)),
        ),
        column,
      ).toBe("42501");
    }
    expect(await codeOf(asTenant(ctx, (e) => e.execute(sql`select * from users limit 1`)))).toBe(
      "42501",
    );
    expect(
      await codeOf(
        asTenant(ctx, (e) =>
          e.execute(
            sql`update users set platform_role = 'SUPER_ADMIN' where id = ${a.owner.userId}`,
          ),
        ),
      ),
    ).toBe("42501");
    expect(
      await codeOf(asTenant(ctx, (e) => e.execute(sql`update users set name = 'x' where false`))),
    ).toBe("42501");
    expect(await codeOf(asTenant(ctx, (e) => e.execute(sql`delete from users where false`)))).toBe(
      "42501",
    );
    expect(
      await codeOf(asTenant(ctx, (e) => e.execute(sql`insert into users default values`))),
    ).toBe("42501");
  });

  it("platform-global tables are read-only in tenant context", async () => {
    const ctx = { workspaceId: a.workspaceId, userId: a.owner.userId };
    for (const table of [
      "permissions",
      "subscription_plans",
      "platform_settings",
      "announcements",
    ]) {
      const t = sql.identifier(table);
      const [first] = await rows<{ column_name: string }>(
        c.db,
        sql`select column_name from information_schema.columns
            where table_schema = 'public' and table_name = ${table} order by ordinal_position limit 1`,
      );
      const col = sql.identifier(first!.column_name);
      expect(
        await codeOf(asTenant(ctx, (e) => e.execute(sql`select count(*) from ${t}`))),
        `${table} select`,
      ).toBe("no error");
      expect(
        await codeOf(asTenant(ctx, (e) => e.execute(sql`insert into ${t} default values`))),
        `${table} insert`,
      ).toBe("42501");
      expect(
        await codeOf(
          asTenant(ctx, (e) => e.execute(sql`update ${t} set ${col} = ${col} where false`)),
        ),
        `${table} update`,
      ).toBe("42501");
      expect(
        await codeOf(asTenant(ctx, (e) => e.execute(sql`delete from ${t} where false`))),
        `${table} delete`,
      ).toBe("42501");
    }
  });

  it("credential and request-plumbing tables are not selectable by ros_tenant", async () => {
    for (const table of [
      "sessions",
      "auth_tokens",
      "rate_limit_buckets",
      "idempotency_records",
      "email_outbox",
    ]) {
      const [row] = await rows<{ ok: boolean }>(
        c.db,
        sql`select has_table_privilege('ros_tenant', ${table}, 'SELECT') as ok`,
      );
      expect(row!.ok, table).toBe(false);
    }
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
      expect(await enabled()).toBe(
        TENANT_TABLES.length + ORGANIZATION_TABLES.length + PAYMENT_TABLES.length,
      );

      // Down scripts run newest first.
      for (const script of ["0005_payments", "0003_organizations", "0002_tenant_rls"]) {
        const down = await readFile(
          path.join(MIGRATIONS_DIR, `../migrations-down/${script}.down.sql`),
          "utf8",
        );
        const statements = down.split("\n").filter((line) => line.trim() && !line.startsWith("--"));
        for (const statement of statements) await handle.db.execute(sql.raw(statement));
      }
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
