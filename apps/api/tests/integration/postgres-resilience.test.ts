import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { connectPostgres, type Executor } from "@ros/database/providers/postgres/client";
import { limitRepository } from "@ros/database/providers/postgres/repositories/core";

/**
 * Behaviour PGlite cannot reproduce (one connection, no pool): a pooled idle
 * client losing its connection, and two real transactions contending for the
 * plan-limit advisory lock. Opt-in: PG_TEST_URL is a superuser URL of a
 * throwaway Postgres 18 (CI's integration-pg job provides one).
 */
const ADMIN_URL = process.env.PG_TEST_URL;

describe.skipIf(!ADMIN_URL)("node-postgres pool resilience", () => {
  it("survives an idle client being terminated and keeps answering", async () => {
    const handle = await connectPostgres(ADMIN_URL!, 2);
    try {
      const first = (await handle.db.execute(sql`select pg_backend_pid() as pid`)) as unknown as {
        rows: { pid: number }[];
      };
      const pid = first.rows[0]!.pid;
      // Kill the (now idle) pooled connection from another connection of the same pool.
      await handle.db.execute(sql`select pg_terminate_backend(${pid})`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      // Without pool.on("error") Node would have exited on the idle client's error event.
      const again = (await handle.db.execute(sql`select 1 as one`)) as unknown as {
        rows: { one: number }[];
      };
      expect(again.rows[0]!.one).toBe(1);
    } finally {
      await handle.close();
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
