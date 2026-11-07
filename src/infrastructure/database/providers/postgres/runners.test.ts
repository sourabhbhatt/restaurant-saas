import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  connectPglite,
  createSystemLookup,
  createSystemRunner,
  createTenantRunner,
  runMigrations,
  type DatabaseHandle,
  type Executor,
} from "./client";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const ROLE = "ros_runner_test";

let handle: DatabaseHandle;
const asRows = (e: Executor) => ({
  rows: async <T>(query: ReturnType<typeof sql>) =>
    ((await e.execute(query)) as unknown as { rows: T[] }).rows,
});

beforeAll(async () => {
  handle = await connectPglite();
  await runMigrations(handle, "pglite");
  // Same shape as the 2026-11-07 spike; the real policies arrive with the RLS migration.
  await handle.db.execute(sql.raw(`create role ${ROLE} nologin`));
  await handle.db.execute(
    sql.raw(`create table runner_probe (workspace_id uuid not null, label text)`),
  );
  await handle.db.execute(sql.raw(`alter table runner_probe enable row level security`));
  await handle.db.execute(
    sql.raw(`create policy probe_isolation on runner_probe for all to ${ROLE}
      using (workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid)`),
  );
  await handle.db.execute(sql.raw(`grant select, insert on runner_probe to ${ROLE}`));
  await handle.db.execute(
    sql.raw(`insert into runner_probe values ('${A}', 'a1'), ('${A}', 'a2'), ('${B}', 'b1')`),
  );
});

afterAll(async () => {
  await handle.close();
});

const labels = (r: ReturnType<typeof asRows>) =>
  r
    .rows<{ label: string }>(sql`select label from runner_probe order by label`)
    .then((rows) => rows.map((x) => x.label));

describe("tenant runner", () => {
  it("tenant read sees only bound workspace rows", async () => {
    const tenant = createTenantRunner(handle.db, asRows, {
      role: ROLE,
      context: () => ({ workspaceId: A, userId: null }),
    });
    expect(await tenant.read(labels)).toEqual(["a1", "a2"]);
    expect(await tenant.run(labels)).toEqual(["a1", "a2"]);
  });

  it("tenant run without context throws TENANT_CONTEXT_MISSING", async () => {
    let queried = false;
    for (const context of [() => null, () => ({ workspaceId: null, userId: null })]) {
      const tenant = createTenantRunner(handle.db, asRows, { role: ROLE, context });
      await expect(
        tenant.run(async () => {
          queried = true;
        }),
      ).rejects.toMatchObject({ name: "TenantContextError", message: "TENANT_CONTEXT_MISSING" });
      await expect(tenant.read(async () => {})).rejects.toThrow("TENANT_CONTEXT_MISSING");
    }
    expect(queried).toBe(false);
  });

  it("settings do not leak to the next transaction on the same connection", async () => {
    const tenant = createTenantRunner(handle.db, asRows, {
      role: ROLE,
      context: () => ({ workspaceId: A, userId: "00000000-0000-4000-8000-0000000000c1" }),
    });
    await tenant.run(labels);
    const system = createSystemRunner(handle.db, asRows);
    const [row] = await system.read((r) =>
      r.rows<{ ws: string | null; uid: string | null; role: string }>(
        sql`select current_setting('app.workspace_id', true) as ws,
                   current_setting('app.user_id', true) as uid, current_user as role`,
      ),
    );
    expect(row!.ws ?? "").toBe("");
    expect(row!.uid ?? "").toBe("");
    expect(row!.role).not.toBe(ROLE);
  });

  it("system runner is unaffected", async () => {
    const system = createSystemRunner(handle.db, asRows);
    expect(await system.read(labels)).toEqual(["a1", "a2", "b1"]);
    expect(await system.run(labels)).toEqual(["a1", "a2", "b1"]);
  });

  it("role null skips SET LOCAL ROLE but still sets the context", async () => {
    const tenant = createTenantRunner(handle.db, asRows, {
      role: null,
      context: () => ({ workspaceId: B, userId: null }),
    });
    const [row] = await tenant.read((r) =>
      r.rows<{ ws: string; role: string }>(
        sql`select current_setting('app.workspace_id', true) as ws, current_user as role`,
      ),
    );
    expect(row).toEqual({ ws: B, role: "postgres" });
    // Connection user is the owner, so the non-forced policy does not apply.
    expect(await tenant.read(labels)).toEqual(["a1", "a2", "b1"]);
  });

  it("rejects role names that are not plain identifiers", () => {
    expect(() =>
      createTenantRunner(handle.db, asRows, { role: "x; drop table users", context: () => null }),
    ).toThrow(/role/);
  });
});

describe("system lookup", () => {
  it("exposes only the named methods and runs them as the owner", async () => {
    const lookup = createSystemLookup(
      handle.db,
      (e: Executor) => ({
        count: async (workspaceId: string) =>
          (
            await asRows(e).rows<{ n: number }>(
              sql`select count(*)::int as n from runner_probe where workspace_id = ${workspaceId}`,
            )
          )[0]!.n,
        wipe: async () => e.execute(sql`delete from runner_probe`),
      }),
      ["count"],
    );
    expect(Object.keys(lookup)).toEqual(["count"]);
    expect(await lookup.count(B)).toBe(1);
    expect("wipe" in lookup).toBe(false);
  });
});
