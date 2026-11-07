import { readFile } from "node:fs/promises";
import path from "node:path";

import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  connectPglite,
  MIGRATIONS_DIR,
  runMigrations,
  type DatabaseHandle,
  type Executor,
} from "@ros/database/providers/postgres/client";
import {
  ORGANIZATION_TABLES,
  PAYMENT_TABLES,
  TENANT_TABLES,
  USER_TABLES,
  WORKSPACE_SCOPED_TABLES,
} from "@ros/database/providers/postgres/tenant-tables";
import { migrateTo } from "@ros/testing/migrate-to";

/**
 * 0006_workspace_and_user_rls: policies only, no schema change. Applied over
 * the 0005 schema through the journal, re-run by hand (idempotent), reverted
 * by its down script, and applied again.
 */

const TAG = "0006_workspace_and_user_rls";
const COVERED = [...WORKSPACE_SCOPED_TABLES, ...USER_TABLES] as readonly string[];
const BEFORE = TENANT_TABLES.length + ORGANIZATION_TABLES.length + PAYMENT_TABLES.length;
const AFTER = BEFORE + COVERED.length;

let handle: DatabaseHandle;

async function rows<T>(e: Executor, query: SQL): Promise<T[]> {
  return ((await e.execute(query)) as unknown as { rows: T[] }).rows;
}

async function rlsCount(): Promise<number> {
  const [row] = await rows<{ n: number }>(
    handle.db,
    sql`select count(*)::int as n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
        where ns.nspname = 'public' and c.relrowsecurity`,
  );
  return row!.n;
}

async function coveredPolicies(): Promise<string[]> {
  return (
    await rows<{ p: string }>(
      handle.db,
      sql`select tablename || '.' || policyname as p from pg_policies
          where schemaname = 'public' and tablename in (${sql.join(
            COVERED.map((t) => sql`${t}`),
            sql`, `,
          )}) order by 1`,
    )
  ).map((r) => r.p);
}

async function workspacesPrivileges(): Promise<string[]> {
  const out: string[] = [];
  for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    const [row] = await rows<{ ok: boolean }>(
      handle.db,
      sql`select has_table_privilege('ros_tenant', 'workspaces', ${privilege}) as ok`,
    );
    if (row!.ok) out.push(privilege);
  }
  return out;
}

async function applyUp() {
  const up = await readFile(path.join(MIGRATIONS_DIR, `${TAG}.sql`), "utf8");
  for (const statement of up.split("--> statement-breakpoint"))
    await handle.db.execute(sql.raw(statement));
}

async function applyDown() {
  const down = await readFile(
    path.join(MIGRATIONS_DIR, `../migrations-down/${TAG}.down.sql`),
    "utf8",
  );
  for (const statement of down.split("\n").filter((l) => l.trim() && !l.startsWith("--")))
    await handle.db.execute(sql.raw(statement));
}

beforeAll(async () => {
  handle = await connectPglite();
  await migrateTo(handle, "0005_payments");
});

afterAll(() => handle.close());

describe("0006_workspace_and_user_rls", () => {
  it("starts from a schema where the eight tables have no RLS and full tenant DML", async () => {
    expect(await rlsCount()).toBe(BEFORE);
    expect(await coveredPolicies()).toEqual([]);
    expect(await workspacesPrivileges()).toEqual(["SELECT", "INSERT", "UPDATE", "DELETE"]);
  });

  it("applies through the journal, re-runs by hand and reverts with the down script", async () => {
    await runMigrations(handle, "pglite");
    expect(await rlsCount()).toBe(AFTER);
    const policies = await coveredPolicies();
    expect(policies.length).toBeGreaterThanOrEqual(COVERED.length * 2);
    expect(await workspacesPrivileges()).toEqual(["SELECT", "UPDATE"]);

    await applyUp();
    expect(await rlsCount()).toBe(AFTER);
    expect(await coveredPolicies()).toEqual(policies);

    await applyDown();
    expect(await rlsCount()).toBe(BEFORE);
    expect(await coveredPolicies()).toEqual([]);
    expect(await workspacesPrivileges()).toEqual(["SELECT", "INSERT", "UPDATE", "DELETE"]);

    await applyUp();
    expect(await rlsCount()).toBe(AFTER);
    expect(await coveredPolicies()).toEqual(policies);
  });
});
