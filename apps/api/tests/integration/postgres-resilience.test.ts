import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";

import { connectPostgres, type Executor } from "@ros/database/providers/postgres/client";
import { limitRepository } from "@ros/database/providers/postgres/repositories/core";

/**
 * Behaviour PGlite cannot reproduce (one connection, no pool): a pooled idle
 * client losing its connection, and two real transactions contending for the
 * plan-limit advisory lock. Opt-in: PG_TEST_URL is a superuser URL of a
 * throwaway Postgres 18 (CI's integration-pg job provides one).
 */
const ADMIN_URL = process.env.PG_TEST_URL;

const rows = async <T>(db: Executor, query: ReturnType<typeof sql>): Promise<T[]> =>
  ((await db.execute(query)) as unknown as { rows: T[] }).rows;
const first = async <T>(db: Executor, query: ReturnType<typeof sql>): Promise<T> => {
  const [row] = await rows<T>(db, query);
  if (row === undefined) throw new Error("query returned no row");
  return row;
};

describe.skipIf(!ADMIN_URL)("node-postgres pool resilience", () => {
  afterEach(() => vi.restoreAllMocks());

  it("survives an idle client being terminated: logs one warning and keeps answering", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pool = await connectPostgres(ADMIN_URL!, 2);
    // A separate single-connection handle does the killing, so the pool's own client is idle
    // (pg-pool hands out the most recently returned client, so killing through the pool would
    // only make the killing query itself fail).
    const killer = await connectPostgres(ADMIN_URL!, 1);
    try {
      const { pid } = await first<{ pid: number }>(pool.db, sql`select pg_backend_pid() as pid`);
      await rows(killer.db, sql`select pg_terminate_backend(${pid})`);
      // Let the idle client's socket error reach pg-pool, which emits "error" on the pool.
      await new Promise((resolve) => setTimeout(resolve, 300));
      // Without pool.on("error") Node would have exited here with an unhandled 'error' event.
      const { one } = await first<{ one: number }>(pool.db, sql`select 1 as one`);
      expect(one).toBe(1);
      const lines = warn.mock.calls.map((call) => String(call[0]));
      expect(lines.some((line) => line.includes('"msg":"pg_pool_idle_client_error"'))).toBe(true);
      expect(lines.join("\n")).not.toContain("postgres://");
      const { again } = await first<{ again: number }>(pool.db, sql`select 2 as again`);
      expect(again).toBe(2);
    } finally {
      await killer.close();
      await pool.close();
    }
  });

  it("the plan-limit advisory lock serialises concurrent transactions until commit", async () => {
    const handle = await connectPostgres(ADMIN_URL!, 2);
    const workspaceId = "11111111-2222-4333-8444-555555555555";
    const events: string[] = [];
    try {
      const a = handle.db.transaction(async (tx) => {
        await limitRepository(tx as unknown as Executor).lockWorkspace(workspaceId);
        events.push("A locked");
        await new Promise((resolve) => setTimeout(resolve, 300));
        events.push("A done");
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const b = handle.db.transaction(async (tx) => {
        await limitRepository(tx as unknown as Executor).lockWorkspace(workspaceId);
        events.push("B locked");
      });
      await Promise.all([a, b]);
      expect(events).toEqual(["A locked", "A done", "B locked"]);
    } finally {
      await handle.close();
    }
  });
});
