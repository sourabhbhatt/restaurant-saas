import { and, desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { connectPglite, runMigrations } from "../client";
import { orders } from "../schema";
import { kitchenRecentFilter } from "./staff-ops";

const WS = "11111111-1111-4111-8111-111111111111";
const BRANCH = "22222222-2222-4222-8222-222222222222";

/**
 * The kitchen "recently done" list runs on every kitchen poll. Under row-level
 * security only leakproof clauses can become index conditions, so the query
 * must be able to use its indexes as the tenant role (the production setup).
 * With a branch history of finished orders and none recent, a usable index
 * answers it from a few index entries; otherwise the planner reads the whole
 * branch history (a sequential scan, or orders_branch_status_idx plus a filter).
 */
describe("kitchen recently-done query under row-level security", () => {
  it("is answered from the done/cancelled indexes as ros_tenant", async () => {
    const handle = await connectPglite();
    try {
      await runMigrations(handle, "pglite");
      const pg = handle.pglite!;
      // 5,000 finished orders from August (foreign keys off: only this table matters here).
      await pg.exec(`
        set session_replication_role = replica;
        insert into orders (workspace_id, restaurant_id, branch_id, table_id, session_id, source,
          order_number, status, currency, subtotal, item_count, idempotency_key,
          accepted_at, served_at, completed_at, created_at, updated_at)
        select '${WS}', gen_random_uuid(), '${BRANCH}', gen_random_uuid(), gen_random_uuid(),
          'STAFF', g, 'COMPLETED', 'INR', 100, 1, 'k' || g, ts, ts, ts, ts, ts
        from generate_series(1, 5000) g,
          lateral (select timestamptz '2026-08-01' + make_interval(mins => g) as ts) t;
        set session_replication_role = origin;
        analyze orders;
      `);
      const query = handle.db
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.workspaceId, WS),
            eq(orders.branchId, BRANCH),
            kitchenRecentFilter(new Date("2026-11-10T08:00:00Z")),
          ),
        )
        .orderBy(desc(orders.updatedAt))
        .limit(50)
        .toSQL();
      await pg.exec("begin");
      try {
        await pg.exec("set local role ros_tenant");
        await pg.query("select set_config('app.workspace_id', $1, true)", [WS]);
        const res = await pg.query<{ "QUERY PLAN": string }>(
          `explain ${query.sql}`,
          query.params as unknown[],
        );
        const plan = res.rows.map((r) => r["QUERY PLAN"]).join("\n");
        expect(plan).toContain("orders_branch_done_recent_idx");
        expect(plan).toContain("orders_branch_cancelled_at_idx");
        // The time bound is an index condition, not a filter over the branch's history.
        expect(plan).toMatch(/Index Cond: .*CASE WHEN \(served_at IS NOT NULL\)/);
      } finally {
        await pg.exec("rollback");
      }
    } finally {
      await handle.close();
    }
  });
});
