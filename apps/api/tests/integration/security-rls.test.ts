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
  USER_TABLES,
  WORKSPACE_SCOPED_TABLES,
} from "@ros/database/providers/postgres/tenant-tables";
import type { Container } from "@/composition/container";
import { addStaffMember } from "@/test/fixtures";
import { createTenantWorld, type TenantWorld } from "@/test/fixtures-rls";
import { createTestContainer } from "@/test/harness";

/**
 * Tables `ros_tenant` may touch without row-level security. Each one is
 * platform reference data that 0002 leaves readable on purpose (tenant
 * INSERT/UPDATE/DELETE revoked there), or `users`, which is readable column
 * by column (id, name, email) and otherwise revoked.
 */
const TENANT_READABLE_WITHOUT_RLS = [
  "announcements",
  "permissions",
  "platform_settings",
  "subscription_plans",
  "users",
] as const;

let c: Container;
let a: TenantWorld;
let b: TenantWorld;
/** Ids of the per-workspace parent rows the 0006 probes hang off. */
let parents: Record<"a" | "b", { supportRequestId: string; upgradeRequestId: string }>;

async function rows<T>(e: Executor, query: SQL): Promise<T[]> {
  return ((await e.execute(query)) as unknown as { rows: T[] }).rows;
}

/** One row per workspace (or user) in every table 0006 covers, for both worlds. */
async function seedScopedRows(world: TenantWorld, other: TenantWorld) {
  const db = c.db;
  const ws = world.workspaceId;
  await db.execute(
    sql`insert into branch_counters (branch_id, name, value) values (${world.branchId}, 'order', 1)
        on conflict (branch_id, name) do nothing`,
  );
  await db.execute(
    sql`insert into role_permissions (role_id, permission_key) values (${world.customRoleId}, 'workspace.update')
        on conflict do nothing`,
  );
  const [support] = await rows<{ id: string }>(
    db,
    sql`select id from support_requests where workspace_id = ${ws} limit 1`,
  );
  await db.execute(
    sql`insert into support_request_notes (request_id, author_id, body, is_internal) values
        (${support!.id}, ${other.owner.userId}, 'internal', true),
        (${support!.id}, ${other.owner.userId}, 'reply', false)`,
  );
  const [upgrade] = await rows<{ id: string }>(
    db,
    sql`select id from upgrade_requests where workspace_id = ${ws} limit 1`,
  );
  await db.execute(
    sql`insert into upgrade_request_events (request_id, type, actor_user_id, body)
        values (${upgrade!.id}, 'CREATED', ${world.owner.userId}, null)`,
  );
  for (const user of [world.owner, world.staff]) {
    await db.execute(
      sql`insert into user_profiles (user_id, phone) values (${user.userId}, '+91 00000')
          on conflict (user_id) do nothing`,
    );
    await db.execute(
      sql`insert into notification_preferences (user_id, type, in_app) values (${user.userId}, 'order.created', false)
          on conflict (user_id, type) do nothing`,
    );
    await db.execute(
      sql`insert into push_subscriptions (user_id, endpoint, keys)
          values (${user.userId}, ${`https://push.example.test/${user.userId}`}, '{"p256dh":"k","auth":"a"}'::jsonb)
          on conflict (endpoint) do nothing`,
    );
  }
  return { supportRequestId: support!.id, upgradeRequestId: upgrade!.id };
}

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
  parents = { a: await seedScopedRows(a, b), b: await seedScopedRows(b, a) };
});

afterAll(() => c.close());

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
    for (const table of [
      ...TENANT_TABLES,
      ...ORGANIZATION_TABLES,
      ...PAYMENT_TABLES,
      ...WORKSPACE_SCOPED_TABLES,
      ...USER_TABLES,
    ]) {
      const mine = policies.filter((p) => p.tablename === table);
      expect(mine.find((p) => p.policyname === "tenant_isolation")?.roles, table).toBe(
        "{ros_tenant}",
      );
      expect(mine.find((p) => p.policyname === "runtime_access")?.roles, table).toBe(
        "{ros_runtime}",
      );
    }
  });

  it("every table ros_tenant can touch has RLS enabled or is an allow-listed reference table", async () => {
    const tables = await rows<{ relname: string; rls: boolean; privileges: string[] }>(
      c.db,
      sql`select c.relname, c.relrowsecurity as rls,
                 array_remove(array[
                   case when has_any_column_privilege('ros_tenant', c.oid, 'SELECT') then 'SELECT' end,
                   case when has_any_column_privilege('ros_tenant', c.oid, 'INSERT') then 'INSERT' end,
                   case when has_any_column_privilege('ros_tenant', c.oid, 'UPDATE') then 'UPDATE' end,
                   case when has_table_privilege('ros_tenant', c.oid, 'DELETE') then 'DELETE' end
                 ], null) as privileges
          from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
          where ns.nspname = 'public' and c.relkind = 'r'
          order by c.relname`,
    );
    const reachable = tables.filter((t) => t.privileges.length > 0);
    expect(reachable.length).toBeGreaterThan(0);
    const unprotected = reachable
      .filter(
        (t) => !t.rls && !(TENANT_READABLE_WITHOUT_RLS as readonly string[]).includes(t.relname),
      )
      .map((t) => `${t.relname} (${t.privileges.join(",")})`);
    expect(unprotected).toEqual([]);
    // The allow-list stays honest: every entry is reachable and really has no RLS.
    for (const name of TENANT_READABLE_WITHOUT_RLS) {
      const t = tables.find((x) => x.relname === name);
      expect(t, name).toBeDefined();
      expect(t!.rls, name).toBe(false);
      expect(t!.privileges, name).toEqual(["SELECT"]);
    }
    expect(tables.map((t) => t.relname)).toEqual(
      expect.arrayContaining([...WORKSPACE_SCOPED_TABLES, ...USER_TABLES]),
    );
  });

  it("the tenant root, child and user tables carry the 0006 policies", async () => {
    const policies = await rows<{ tablename: string; policyname: string; cmd: string }>(
      c.db,
      sql`select tablename, policyname, cmd from pg_policies
          where schemaname = 'public' and 'ros_tenant' = any(roles)
            and tablename in (${sql.join(
              [...WORKSPACE_SCOPED_TABLES, ...USER_TABLES].map((t) => sql`${t}`),
              sql`, `,
            )})
          order by tablename, policyname`,
    );
    expect(policies).toEqual([
      { tablename: "branch_counters", policyname: "tenant_isolation", cmd: "ALL" },
      { tablename: "notification_preferences", policyname: "tenant_isolation", cmd: "ALL" },
      {
        tablename: "notification_preferences",
        policyname: "tenant_workspace_members",
        cmd: "SELECT",
      },
      { tablename: "push_subscriptions", policyname: "tenant_isolation", cmd: "ALL" },
      { tablename: "role_permissions", policyname: "tenant_isolation", cmd: "ALL" },
      { tablename: "role_permissions", policyname: "tenant_system_roles", cmd: "SELECT" },
      { tablename: "support_request_notes", policyname: "tenant_isolation", cmd: "ALL" },
      { tablename: "upgrade_request_events", policyname: "tenant_isolation", cmd: "ALL" },
      { tablename: "user_profiles", policyname: "tenant_isolation", cmd: "ALL" },
      { tablename: "workspaces", policyname: "tenant_isolation", cmd: "ALL" },
      { tablename: "workspaces", policyname: "tenant_own_rows", cmd: "SELECT" },
    ]);
    for (const privilege of ["INSERT", "DELETE"]) {
      const [row] = await rows<{ ok: boolean }>(
        c.db,
        sql`select has_table_privilege('ros_tenant', 'workspaces', ${privilege}) as ok`,
      );
      expect(row!.ok, `workspaces ${privilege}`).toBe(false);
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
      .filter(
        (p) =>
          p.policyname !== "tenant_isolation" &&
          (TENANT_TABLES as readonly string[]).includes(p.tablename),
      )
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

describe("tenant root, child and user tables (0006)", () => {
  const ctxA = () => ({ workspaceId: a.workspaceId, userId: a.owner.userId });

  it("workspaces: the bound one and own memberships are readable, only the bound one updatable", async () => {
    const seen = await asTenant(ctxA(), (e) =>
      rows<{ id: string }>(e, sql`select id from workspaces`),
    );
    expect(seen.map((w) => w.id)).toEqual([a.workspaceId]);

    // a.staff is an active member of A and B: both are visible (workspace switcher), B stays read-only.
    const member = { workspaceId: a.workspaceId, userId: a.staff.userId };
    const both = await asTenant(member, (e) =>
      rows<{ id: string }>(e, sql`select id from workspaces`),
    );
    expect(new Set(both.map((w) => w.id))).toEqual(new Set([a.workspaceId, b.workspaceId]));
    for (const ctx of [ctxA(), member]) {
      for (const stmt of [
        sql`update workspaces set name = 'Hijacked' where id = ${b.workspaceId} returning id`,
        sql`update workspaces set deleted_at = now() where id = ${b.workspaceId} returning id`,
        sql`update workspaces set organization_id = (select organization_id from workspaces where id = ${a.workspaceId}) where id = ${b.workspaceId} returning id`,
      ]) {
        expect(await asTenant(ctx, (e) => rows(e, stmt))).toEqual([]);
      }
    }
    const [bRow] = await rows<{ name: string; deleted_at: string | null }>(
      c.db,
      sql`select name, deleted_at from workspaces where id = ${b.workspaceId}`,
    );
    expect(bRow).toMatchObject({ deleted_at: null });
    expect(bRow!.name).not.toBe("Hijacked");

    const own = await asTenant(ctxA(), (e) =>
      rows<{ id: string }>(
        e,
        sql`update workspaces set version = version + 1 where id = ${a.workspaceId} returning id`,
      ),
    );
    expect(own).toEqual([{ id: a.workspaceId }]);

    expect(
      await codeOf(
        asTenant(ctxA(), (e) =>
          e.execute(sql`insert into workspaces (name, slug) values ('Evil', 'evil-rls')`),
        ),
      ),
    ).toBe("42501");
    expect(
      await codeOf(
        asTenant(ctxA(), (e) => e.execute(sql`delete from workspaces where id = ${a.workspaceId}`)),
      ),
    ).toBe("42501");
  });

  it("branch_counters: only counters of the bound workspace's branches", async () => {
    const seen = await asTenant(ctxA(), (e) =>
      rows<{ branch_id: string }>(e, sql`select branch_id from branch_counters`),
    );
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((r) => r.branch_id === a.branchId)).toBe(true);

    const before = await n(
      c.db,
      sql`select value as n from branch_counters where branch_id = ${b.branchId} and name = 'order'`,
    );
    expect(
      await asTenant(ctxA(), (e) =>
        rows(
          e,
          sql`update branch_counters set value = 0 where branch_id = ${b.branchId} returning name`,
        ),
      ),
    ).toEqual([]);
    expect(
      await asTenant(ctxA(), (e) =>
        rows(e, sql`delete from branch_counters where branch_id = ${b.branchId} returning name`),
      ),
    ).toEqual([]);
    expect(
      await codeOf(
        asTenant(ctxA(), (e) =>
          e.execute(
            sql`insert into branch_counters (branch_id, name, value) values (${b.branchId}, 'order', 0)
                on conflict (branch_id, name) do update set value = 0`,
          ),
        ),
      ),
    ).toBe("42501");
    expect(
      await n(
        c.db,
        sql`select value as n from branch_counters where branch_id = ${b.branchId} and name = 'order'`,
      ),
    ).toBe(before);

    const bumped = await asTenant(ctxA(), (e) =>
      rows<{ value: number }>(
        e,
        sql`insert into branch_counters (branch_id, name, value) values (${a.branchId}, 'order', 1)
            on conflict (branch_id, name) do update set value = branch_counters.value + 1 returning value`,
      ),
    );
    expect(bumped).toHaveLength(1);
  });

  it("role_permissions: own and system roles readable, only own roles writable", async () => {
    const seen = await asTenant(ctxA(), (e) =>
      rows<{ role_id: string; workspace_id: string | null }>(
        e,
        sql`select rp.role_id, r.workspace_id from role_permissions rp join roles r on r.id = rp.role_id`,
      ),
    );
    expect(seen.some((r) => r.workspace_id === null)).toBe(true);
    expect(seen.some((r) => r.role_id === a.customRoleId)).toBe(true);
    expect(seen.some((r) => r.workspace_id === b.workspaceId)).toBe(false);
    expect(seen.some((r) => r.role_id === b.customRoleId)).toBe(false);

    expect(
      await codeOf(
        asTenant(ctxA(), (e) =>
          e.execute(
            sql`insert into role_permissions (role_id, permission_key) values (${b.customRoleId}, 'workspace.view')`,
          ),
        ),
      ),
    ).toBe("42501");
    expect(
      await codeOf(
        asTenant(ctxA(), (e) =>
          e.execute(
            sql`insert into role_permissions (role_id, permission_key)
                select id, 'workspace.view' from roles where workspace_id is null limit 1`,
          ),
        ),
      ),
    ).toBe("42501");
    expect(
      await asTenant(ctxA(), (e) =>
        rows(
          e,
          sql`delete from role_permissions where role_id = ${b.customRoleId} returning role_id`,
        ),
      ),
    ).toEqual([]);
    expect(
      await asTenant(ctxA(), (e) =>
        rows(
          e,
          sql`delete from role_permissions where role_id in (select id from roles where workspace_id is null) returning role_id`,
        ),
      ),
    ).toEqual([]);
    expect(
      await n(
        c.db,
        sql`select count(*)::int as n from role_permissions where role_id = ${b.customRoleId}`,
      ),
    ).toBe(1);

    const added = await asTenant(ctxA(), (e) =>
      rows(
        e,
        sql`insert into role_permissions (role_id, permission_key) values (${a.customRoleId}, 'workspace.view') returning role_id`,
      ),
    );
    expect(added).toHaveLength(1);
    const removed = await asTenant(ctxA(), (e) =>
      rows(
        e,
        sql`delete from role_permissions where role_id = ${a.customRoleId} and permission_key = 'workspace.view' returning role_id`,
      ),
    );
    expect(removed).toHaveLength(1);
  });

  it("support_request_notes: own requests' public notes only, never internal ones", async () => {
    const seen = await asTenant(ctxA(), (e) =>
      rows<{ request_id: string; body: string; is_internal: boolean }>(
        e,
        sql`select request_id, body, is_internal from support_request_notes`,
      ),
    );
    expect(seen).toEqual([
      { request_id: parents.a.supportRequestId, body: "reply", is_internal: false },
    ]);

    expect(
      await asTenant(ctxA(), (e) =>
        rows(
          e,
          sql`update support_request_notes set body = 'x' where request_id = ${parents.b.supportRequestId} returning id`,
        ),
      ),
    ).toEqual([]);
    expect(
      await asTenant(ctxA(), (e) =>
        rows(e, sql`delete from support_request_notes where is_internal returning id`),
      ),
    ).toEqual([]);
    expect(
      await codeOf(
        asTenant(ctxA(), (e) =>
          e.execute(
            sql`insert into support_request_notes (request_id, body, is_internal) values (${parents.b.supportRequestId}, 'x', false)`,
          ),
        ),
      ),
    ).toBe("42501");
    expect(
      await codeOf(
        asTenant(ctxA(), (e) =>
          e.execute(
            sql`insert into support_request_notes (request_id, body, is_internal) values (${parents.a.supportRequestId}, 'x', true)`,
          ),
        ),
      ),
    ).toBe("42501");
    expect(
      await n(
        c.db,
        sql`select count(*)::int as n from support_request_notes where request_id = ${parents.b.supportRequestId}`,
      ),
    ).toBe(2);
  });

  it("upgrade_request_events: only events of the bound workspace's requests", async () => {
    const seen = await asTenant(ctxA(), (e) =>
      rows<{ request_id: string }>(e, sql`select request_id from upgrade_request_events`),
    );
    expect(seen).toEqual([{ request_id: parents.a.upgradeRequestId }]);
    expect(
      await asTenant(ctxA(), (e) =>
        rows(
          e,
          sql`update upgrade_request_events set type = 'APPROVED' where request_id = ${parents.b.upgradeRequestId} returning id`,
        ),
      ),
    ).toEqual([]);
    expect(
      await asTenant(ctxA(), (e) =>
        rows(
          e,
          sql`delete from upgrade_request_events where request_id = ${parents.b.upgradeRequestId} returning id`,
        ),
      ),
    ).toEqual([]);
    expect(
      await codeOf(
        asTenant(ctxA(), (e) =>
          e.execute(
            sql`insert into upgrade_request_events (request_id, type) values (${parents.b.upgradeRequestId}, 'APPROVED')`,
          ),
        ),
      ),
    ).toBe("42501");
    const own = await asTenant(ctxA(), (e) =>
      rows(
        e,
        sql`insert into upgrade_request_events (request_id, type) values (${parents.a.upgradeRequestId}, 'COMMENT') returning id`,
      ),
    );
    expect(own).toHaveLength(1);
  });

  it.each(["user_profiles", "push_subscriptions"] as const)(
    "%s: the bound user's own rows only",
    async (table) => {
      const t = sql.identifier(table);
      const seen = await asTenant(ctxA(), (e) =>
        rows<{ user_id: string }>(e, sql`select user_id from ${t}`),
      );
      expect(seen.length).toBeGreaterThan(0);
      expect(new Set(seen.map((r) => r.user_id))).toEqual(new Set([a.owner.userId]));

      // Neither a co-member of A nor B's owner is reachable, not even to update or delete.
      for (const victim of [a.staff.userId, b.owner.userId]) {
        expect(
          await asTenant(ctxA(), (e) =>
            rows(e, sql`delete from ${t} where user_id = ${victim} returning user_id`),
          ),
        ).toEqual([]);
        expect(
          await asTenant(ctxA(), (e) =>
            rows(
              e,
              sql`update ${t} set user_id = ${a.owner.userId} where user_id = ${victim} returning user_id`,
            ),
          ).catch((error: unknown) => pgCode(error)),
        ).toSatisfy((r: unknown) => r === "42501" || (Array.isArray(r) && r.length === 0));
        expect(
          await n(c.db, sql`select count(*)::int as n from ${t} where user_id = ${victim}`),
        ).toBe(1);
      }
    },
  );

  it("user_profiles and push_subscriptions: rows for another user cannot be inserted", async () => {
    expect(
      await codeOf(
        asTenant(ctxA(), (e) =>
          e.execute(
            sql`insert into user_profiles (user_id, phone) values (${b.staff.userId}, '1')`,
          ),
        ),
      ),
    ).toBe("42501");
    expect(
      await codeOf(
        asTenant(ctxA(), (e) =>
          e.execute(
            sql`insert into push_subscriptions (user_id, endpoint, keys) values (${b.staff.userId}, 'https://push.example.test/evil', '{}'::jsonb)`,
          ),
        ),
      ),
    ).toBe("42501");
    const own = await asTenant(ctxA(), (e) =>
      rows(
        e,
        sql`update user_profiles set phone = '+91 11111' where user_id = ${a.owner.userId} returning user_id`,
      ),
    );
    expect(own).toHaveLength(1);
  });

  it("notification_preferences: own rows writable, co-members' readable for the fan-out, strangers' hidden", async () => {
    const seen = await asTenant(ctxA(), (e) =>
      rows<{ user_id: string }>(e, sql`select user_id from notification_preferences`),
    );
    expect(new Set(seen.map((r) => r.user_id))).toEqual(new Set([a.owner.userId, a.staff.userId]));

    for (const victim of [a.staff.userId, b.owner.userId]) {
      expect(
        await asTenant(ctxA(), (e) =>
          rows(
            e,
            sql`update notification_preferences set in_app = true where user_id = ${victim} returning id`,
          ),
        ),
      ).toEqual([]);
      expect(
        await asTenant(ctxA(), (e) =>
          rows(e, sql`delete from notification_preferences where user_id = ${victim} returning id`),
        ),
      ).toEqual([]);
      expect(
        await codeOf(
          asTenant(ctxA(), (e) =>
            e.execute(
              sql`insert into notification_preferences (user_id, type, in_app) values (${victim}, 'order.ready', false)`,
            ),
          ),
        ),
      ).toBe("42501");
    }
    const own = await asTenant(ctxA(), (e) =>
      rows(
        e,
        sql`insert into notification_preferences (user_id, type, in_app) values (${a.owner.userId}, 'order.ready', false)
            on conflict (user_id, type) do update set in_app = excluded.in_app returning id`,
      ),
    );
    expect(own).toHaveLength(1);
  });
});

describe("tenant_rls migration", () => {
  it("re-runs cleanly and the down script reverts it", async () => {
    const handle = await connectPglite();
    try {
      await runMigrations(handle, "pglite");
      for (const file of ["0002_tenant_rls.sql", "0006_workspace_and_user_rls.sql"]) {
        const up = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
        for (const statement of up.split("--> statement-breakpoint"))
          await handle.db.execute(sql.raw(statement));
      }
      const enabled = () =>
        n(
          handle.db,
          sql`select count(*)::int as n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
              where ns.nspname = 'public' and c.relrowsecurity`,
        );
      expect(await enabled()).toBe(
        TENANT_TABLES.length +
          ORGANIZATION_TABLES.length +
          PAYMENT_TABLES.length +
          WORKSPACE_SCOPED_TABLES.length +
          USER_TABLES.length,
      );

      // Down scripts run newest first.
      for (const script of [
        "0006_workspace_and_user_rls",
        "0005_payments",
        "0003_organizations",
        "0002_tenant_rls",
      ]) {
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
