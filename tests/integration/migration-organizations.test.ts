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
  type DatabaseHandle,
  type Executor,
} from "@/infrastructure/database/providers/postgres/client";
import { countRows } from "@/infrastructure/database/providers/postgres/row-counts";
import { ORGANIZATION_TABLES } from "@/infrastructure/database/providers/postgres/tenant-tables";
import { migrateTo } from "@/test/migrate-to";

/**
 * 0003_organizations: expand (new tables and nullable columns) plus a backfill
 * that gives every existing workspace an organization with the same id. Seeds
 * the pre-migration schema the way the owner's data looks, then migrates.
 */

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const W1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const W2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const W3 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PLAN = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OWNER_ROLE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const MEMBER_ROLE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const W1_TRIAL_END = "2026-11-30T10:00:00.000Z";

/** Everything after this marker in 0003 is hand-written and re-runnable. */
const BACKFILL_MARKER = "-- backfill:begin";

let handle: DatabaseHandle;
let before: Record<string, number>;
let trialBefore: string;

async function rows<T>(e: Executor, query: SQL): Promise<T[]> {
  return ((await e.execute(query)) as unknown as { rows: T[] }).rows;
}

async function one<T>(e: Executor, query: SQL): Promise<T> {
  const [row] = await rows<T>(e, query);
  return row!;
}

function asTenant<T>(context: DbContext, work: (e: Executor) => Promise<T>): Promise<T> {
  return createTenantRunner(handle.db, (e) => e, {
    role: "ros_tenant",
    context: () => context,
  }).run(work);
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

async function trialEndText(e: Executor): Promise<string> {
  const row = await one<{ t: string }>(
    e,
    sql`select trial_ends_at::text as t from subscriptions where workspace_id = ${W1} and is_current`,
  );
  return row.t;
}

async function runBackfillSection(e: Executor): Promise<void> {
  const file = await readFile(path.join(MIGRATIONS_DIR, "0003_organizations.sql"), "utf8");
  const at = file.indexOf(BACKFILL_MARKER);
  expect(at, "0003 has the backfill marker").toBeGreaterThan(0);
  for (const statement of file.slice(at).split("--> statement-breakpoint")) {
    if (statement.trim()) await e.execute(sql.raw(statement));
  }
}

beforeAll(async () => {
  handle = await connectPglite();
  await migrateTo(handle, "0002_tenant_rls");
  const db = handle.db;
  await db.execute(sql`insert into users (id, email, name) values
    (${U1}, 'one@example.test', 'One'), (${U2}, 'two@example.test', 'Two')`);
  await db.execute(sql`insert into roles (id, key, name, scope, is_system) values
    (${OWNER_ROLE}, 'workspace_owner', 'Owner', 'WORKSPACE', true),
    (${MEMBER_ROLE}, 'workspace_member', 'Member', 'WORKSPACE', true)`);
  await db.execute(sql`insert into subscription_plans (id, key, name, limits, features)
    values (${PLAN}, 'pro', 'Pro', '{}'::jsonb, '[]'::jsonb)`);
  await db.execute(sql`insert into workspaces (id, name, slug, created_by, created_at) values
    (${W1}, 'Trial Kitchen', 'trial-kitchen', ${U1}, '2026-11-15T10:00:00Z'),
    (${W2}, 'Annual Bistro', 'annual-bistro', ${U2}, '2026-01-01T00:00:00Z'),
    (${W3}, 'Orphan Cafe', 'orphan-cafe', null, '2026-06-01T00:00:00Z')`);
  // W3 has no creator: the earliest workspace_owner membership (U2) becomes the owner.
  await db.execute(
    sql`insert into workspace_memberships (workspace_id, user_id, role_id, created_at) values
    (${W1}, ${U1}, ${OWNER_ROLE}, '2026-11-15T10:00:00Z'),
    (${W2}, ${U2}, ${OWNER_ROLE}, '2026-01-01T00:00:00Z'),
    (${W3}, ${U1}, ${MEMBER_ROLE}, '2026-06-01T00:00:00Z'),
    (${W3}, ${U2}, ${OWNER_ROLE}, '2026-06-02T00:00:00Z')`,
  );
  await db.execute(sql`insert into subscriptions
    (workspace_id, plan_id, status, billing_cycle, trial_starts_at, trial_ends_at,
     current_period_start, current_period_end, is_current) values
    (${W1}, ${PLAN}, 'TRIALING', 'MONTHLY', '2026-11-15T10:00:00Z', ${W1_TRIAL_END}, null, null, true),
    (${W2}, ${PLAN}, 'TRIALING', 'MONTHLY', '2026-01-01T00:00:00Z', '2026-01-31T00:00:00Z', null, null, false),
    (${W2}, ${PLAN}, 'ACTIVE', 'ANNUAL', null, null, '2026-02-01T00:00:00Z', '2027-02-01T00:00:00Z', true),
    (${W3}, ${PLAN}, 'TRIALING', 'MONTHLY', '2026-06-01T00:00:00Z', '2026-07-01T00:00:00Z', null, null, true)`);
  before = await countRows(db);
  trialBefore = await trialEndText(db);
  expect(before.organizations).toBeUndefined();

  await runMigrations(handle, "pglite");
});

afterAll(() => handle.close());

describe("0003_organizations backfill", () => {
  it("preserves every row and trial date", async () => {
    const db = handle.db;
    const after = await countRows(db);
    for (const [table, n] of Object.entries(before)) expect(after[table], table).toBe(n);
    expect(after.organizations).toBe(3);
    expect(after.organization_members).toBe(3);

    const ws = await rows<{ id: string; organization_id: string | null }>(
      db,
      sql`select id, organization_id from workspaces`,
    );
    expect(ws).toHaveLength(3);
    for (const w of ws) expect(w.organization_id, w.id).toBe(w.id);

    const subs = await rows<{ workspace_id: string; organization_id: string | null }>(
      db,
      sql`select workspace_id, organization_id from subscriptions`,
    );
    expect(subs).toHaveLength(4);
    for (const s of subs) expect(s.organization_id).toBe(s.workspace_id);

    expect(await trialEndText(db)).toBe(trialBefore);
    const w1 = await one<{ trial_ends_at: Date }>(
      db,
      sql`select trial_ends_at from subscriptions where workspace_id = ${W1} and is_current`,
    );
    expect(new Date(w1.trial_ends_at).toISOString()).toBe(W1_TRIAL_END);

    const orgs = await rows<{ id: string; name: string; created_by: string | null }>(
      db,
      sql`select id, name, created_by from organizations order by name`,
    );
    expect(orgs).toEqual([
      { id: W2, name: "Annual Bistro", created_by: U2 },
      { id: W3, name: "Orphan Cafe", created_by: null },
      { id: W1, name: "Trial Kitchen", created_by: U1 },
    ]);

    const members = await rows<{ organization_id: string; user_id: string; role: string }>(
      db,
      sql`select organization_id, user_id, role from organization_members order by organization_id`,
    );
    expect(members).toEqual([
      { organization_id: W1, user_id: U1, role: "OWNER" },
      { organization_id: W2, user_id: U2, role: "OWNER" },
      { organization_id: W3, user_id: U2, role: "OWNER" },
    ]);
  });

  it("is idempotent", async () => {
    const db = handle.db;
    const snapshot = async () => ({
      counts: await countRows(db),
      members: await rows(
        db,
        sql`select organization_id, user_id, role from organization_members order by organization_id`,
      ),
      orgs: await rows(
        db,
        sql`select id, name, created_by, updated_at from organizations order by id`,
      ),
      trial: await trialEndText(db),
    });
    const first = await snapshot();
    await runBackfillSection(db);
    expect(await snapshot()).toEqual(first);
  });

  it("allows one current subscription per organization", async () => {
    expect(
      await codeOf(
        handle.db.execute(
          sql`insert into subscriptions (workspace_id, organization_id, plan_id, status, is_current)
              values (${W2}, ${W1}, ${PLAN}, 'ACTIVE', true)`,
        ),
      ),
    ).toBe("23505");
  });
});

describe("organization tables under row-level security", () => {
  it("every organization table has RLS and both policies", async () => {
    const tables = await rows<{ relname: string; rls: boolean }>(
      handle.db,
      sql`select relname, relrowsecurity as rls from pg_class c
          join pg_namespace ns on ns.oid = c.relnamespace
          where ns.nspname = 'public' and relname in ('organizations', 'organization_members')`,
    );
    expect(tables.map((t) => t.relname).sort()).toEqual([...ORGANIZATION_TABLES].sort());
    expect(tables.every((t) => t.rls)).toBe(true);
  });

  it("a workspace context sees its own organization and membership only", async () => {
    const ctx = { workspaceId: W1, userId: U1 };
    const orgs = await asTenant(ctx, (e) =>
      rows<{ id: string }>(e, sql`select id from organizations`),
    );
    expect(orgs.map((o) => o.id)).toEqual([W1]);
    const members = await asTenant(ctx, (e) =>
      rows<{ organization_id: string }>(e, sql`select organization_id from organization_members`),
    );
    expect(members.map((m) => m.organization_id)).toEqual([W1]);
  });

  it("a user context sees every organization it belongs to", async () => {
    const ctx = { workspaceId: null, userId: U2 };
    const orgs = await asTenant(ctx, (e) =>
      rows<{ id: string }>(e, sql`select id from organizations order by id`),
    );
    expect(orgs.map((o) => o.id)).toEqual([W2, W3]);
    const stranger = await asTenant({ workspaceId: W1, userId: U1 }, (e) =>
      rows<{ id: string }>(e, sql`select id from organizations where id <> ${W1}`),
    );
    expect(stranger).toEqual([]);
  });

  it("tenants cannot write organizations or their members", async () => {
    const ctx = { workspaceId: W1, userId: U1 };
    expect(
      await codeOf(
        asTenant(ctx, (e) =>
          e.execute(sql`update organizations set max_workspaces_override = 99 where id = ${W1}`),
        ),
      ),
    ).toBe("42501");
    expect(
      await codeOf(
        asTenant(ctx, (e) =>
          e.execute(sql`update organizations set name = 'Renamed' where id = ${W1}`),
        ),
      ),
    ).toBe("42501");
    expect(
      await codeOf(
        asTenant(ctx, (e) =>
          e.execute(
            sql`insert into organization_members (organization_id, user_id, role) values (${W1}, ${U2}, 'OWNER')`,
          ),
        ),
      ),
    ).toBe("42501");
    expect(
      await codeOf(
        asTenant(ctx, (e) =>
          e.execute(
            sql`update organization_members set user_id = ${U2} where organization_id = ${W1}`,
          ),
        ),
      ),
    ).toBe("42501");
    expect(
      await codeOf(
        asTenant(ctx, (e) => e.execute(sql`delete from organizations where id = ${W1}`)),
      ),
    ).toBe("42501");
    expect(
      await codeOf(
        asTenant(ctx, (e) =>
          e.execute(sql`delete from organization_members where organization_id = ${W1}`),
        ),
      ),
    ).toBe("42501");
    const override = await one<{ v: number | null }>(
      handle.db,
      sql`select max_workspaces_override as v from organizations where id = ${W1}`,
    );
    expect(override.v).toBeNull();
  });
});
