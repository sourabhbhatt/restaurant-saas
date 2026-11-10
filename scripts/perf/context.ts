/**
 * Prints the ids the perf harness needs (workspace, branches, guest QR tokens,
 * bills, sessions) as JSON. Reads the database directly, so the API must not
 * be holding the PGlite directory. QR tokens are decrypted with APP_SECRET
 * (the same secret the seed used); the secret itself is never printed.
 * Usage: tsx --conditions=react-server scripts/perf/context.ts   (PGLITE_DATA_DIR or PERF_DATABASE_URL)
 */
import { decryptQrToken } from "../../packages/application/src/modules/tables/qr-tokens";
import {
  connectPglite,
  connectPostgres,
  type Executor,
} from "../../packages/database/src/providers/postgres/client";

async function rows<T>(db: Executor, query: string): Promise<T[]> {
  return ((await db.execute(query)) as unknown as { rows: T[] }).rows;
}

async function main() {
  const secret = process.env.APP_SECRET;
  if (!secret) throw new Error("APP_SECRET is required to decrypt the seeded QR tokens");
  const url = process.env.PERF_DATABASE_URL;
  const handle = url
    ? await connectPostgres(url, 1)
    : await connectPglite(process.env.PGLITE_DATA_DIR ?? "");
  try {
    const db = handle.db;
    const [ws] = await rows<{ id: string; restaurant_id: string }>(
      db,
      `select w.id, r.id as restaurant_id from workspaces w join restaurants r on r.workspace_id = w.id
       where w.name = 'Demo Hospitality Group' order by w.created_at limit 1`,
    );
    if (!ws) throw new Error("Demo workspace not found: run the demo seed first");
    const branches = await rows<{ id: string; name: string }>(
      db,
      `select id, name from branches where workspace_id = '${ws.id}' order by name`,
    );
    const out = [];
    for (const b of branches) {
      const qr = await rows<{ name: string; table_id: string; token_ciphertext: string }>(
        db,
        `select t.name, t.id as table_id, q.token_ciphertext from table_qr_tokens q
         join dining_tables t on t.id = q.table_id
         where q.branch_id = '${b.id}' and q.status = 'ACTIVE' and t.name in ('T1', 'T2')
         order by t.name`,
      );
      const [issued] = await rows<{ id: string; session_id: string }>(
        db,
        `select id, session_id from bills where branch_id = '${b.id}' and status = 'ISSUED' order by bill_number limit 1`,
      );
      const [closed] = await rows<{ id: string }>(
        db,
        `select id from bills where branch_id = '${b.id}' and status = 'CLOSED' order by bill_number desc limit 1`,
      );
      const [openSession] = await rows<{ id: string; table_id: string }>(
        db,
        `select id, table_id from table_sessions where branch_id = '${b.id}' and status = 'OPEN' order by opened_at limit 1`,
      );
      const freeTables = await rows<{ id: string }>(
        db,
        `select t.id from dining_tables t where t.branch_id = '${b.id}' and t.deleted_at is null
           and not exists (select 1 from table_sessions s where s.table_id = t.id and s.status <> 'CLOSED')
           and t.sort_order > 14 order by t.sort_order`,
      );
      const items = await rows<{ id: string }>(
        db,
        `select mi.id from menu_items mi
         where mi.workspace_id = '${ws.id}' and mi.deleted_at is null and mi.is_available
           and not exists (select 1 from menu_variants v where v.item_id = mi.id)
           and not exists (select 1 from addon_groups g where g.item_id = mi.id and g.min_select > 0)
         order by mi.created_at limit 20`,
      );
      out.push({
        id: b.id,
        name: b.name,
        qr: Object.fromEntries(
          qr.map((q) => [
            q.name,
            { tableId: q.table_id, token: decryptQrToken(q.token_ciphertext, secret) },
          ]),
        ),
        issuedBillId: issued?.id ?? null,
        billedSessionId: issued?.session_id ?? null,
        closedBillId: closed?.id ?? null,
        openSessionId: openSession?.id ?? null,
        freeTableIds: freeTables.map((t) => t.id),
        menuItemIds: items.map((i) => i.id),
      });
    }
    const [counts] = await rows<Record<string, number>>(
      db,
      `select (select count(*) from orders)::int as orders, (select count(*) from order_items)::int as order_items,
        (select count(*) from menu_items)::int as menu_items, (select count(*) from bills)::int as bills`,
    );
    console.log(
      JSON.stringify({ workspaceId: ws.id, restaurantId: ws.restaurant_id, branches: out, counts }),
    );
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message ?? error);
  process.exit(1);
});
