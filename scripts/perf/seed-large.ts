/**
 * Synthetic "busy restaurant" dataset for performance tests. Runs on top of the
 * demo seed (`pnpm db:seed`) and adds, to the demo workspace:
 *   - 20 categories x 15 items (300 menu items; every 3rd has variants, every 4th an add-on group)
 *   - 28 more tables per branch (40 per branch)
 *   - PERF_DAYS days of closed table sessions (PERF_SESSIONS_PER_DAY per branch per day,
 *     1-4 orders each, 1-5 lines per order), bills, bill items, payments, status history
 *   - a live service per branch: open sessions with PENDING/ACCEPTED/PREPARING/READY/SERVED
 *     orders and two bill-requested tables with issued, unpaid bills
 * Tables T1 and T2 of each branch stay free so the harness can open guest sessions there.
 *
 * Deterministic (setseed) and done in one transaction with set-based SQL.
 * Usage: PGLITE_DATA_DIR=/abs/dir tsx scripts/perf/seed-large.ts
 *        PERF_DATABASE_URL=postgres://... tsx scripts/perf/seed-large.ts
 */
import { appendFileSync, existsSync } from "node:fs";
import path from "node:path";

import {
  connectPglite,
  connectPostgres,
  type Executor,
} from "../../packages/database/src/providers/postgres/client";

const DAYS = Number(process.env.PERF_DAYS ?? 100);
const SESSIONS_PER_DAY = Number(process.env.PERF_SESSIONS_PER_DAY ?? 40);

const STATEMENTS = (days: number, perDay: number): string[] => [
  `select setseed(0.42)`,
  `create temp table perf_ctx on commit drop as
     select w.id as workspace_id, r.id as restaurant_id, m.id as menu_id,
       (select id from users where email = 'waiter@demo.local') as waiter_id,
       (select id from users where email = 'cashier@demo.local') as cashier_id
     from workspaces w
       join restaurants r on r.workspace_id = w.id
       join menus m on m.restaurant_id = r.id
     where w.name = 'Demo Hospitality Group' and w.deleted_at is null
     order by w.created_at limit 1`,
  // ---------------------------------------------------------------- menu
  `insert into menu_categories (workspace_id, restaurant_id, menu_id, name, sort_order)
     select c.workspace_id, c.restaurant_id, c.menu_id, 'Perf Category ' || g, 100 + g
     from perf_ctx c, generate_series(1, 20) g`,
  `insert into menu_items (workspace_id, restaurant_id, category_id, name, description, price,
       dietary, prep_time_minutes, sort_order, allergens, is_featured)
     select mc.workspace_id, mc.restaurant_id, mc.id, mc.name || ' Dish ' || i,
       'Synthetic dish ' || i || ' of ' || mc.name || ', made fresh to order with seasonal ingredients.',
       (100 + floor(random() * 400))::int * 100,
       (array['VEG','NON_VEG','EGG','VEGAN'])[1 + floor(random() * 4)::int],
       5 + floor(random() * 25)::int, i,
       case when random() < 0.3 then array['DAIRY'] else '{}'::text[] end, i = 1
     from menu_categories mc, generate_series(1, 15) i
     where mc.name like 'Perf Category %' and mc.workspace_id = (select workspace_id from perf_ctx)`,
  `create temp table perf_menu on commit drop as
     select row_number() over (order by mi.created_at, mi.id)::int as idx, mi.id, mi.name, mi.price,
       mi.dietary, mc.name as category_name
     from menu_items mi join menu_categories mc on mc.id = mi.category_id
     where mi.workspace_id = (select workspace_id from perf_ctx) and mi.deleted_at is null`,
  `insert into menu_variants (workspace_id, item_id, name, price, is_default, sort_order)
     select (select workspace_id from perf_ctx), m.id, v.name, round(m.price * v.f)::bigint, v.d, v.s
     from perf_menu m,
       (values ('Half', 0.65, false, 0), ('Full', 1.0, true, 1)) as v(name, f, d, s)
     where m.category_name like 'Perf Category %' and m.idx % 3 = 0`,
  `insert into addon_groups (workspace_id, item_id, name, min_select, max_select)
     select (select workspace_id from perf_ctx), m.id, 'Extras', 0, 2
     from perf_menu m where m.category_name like 'Perf Category %' and m.idx % 4 = 0`,
  `insert into addons (workspace_id, group_id, name, price, sort_order)
     select g.workspace_id, g.id, a.name, a.price, a.s
     from addon_groups g join perf_menu m on m.id = g.item_id,
       (values ('Extra Cheese', 4000, 0), ('Mint Chutney', 1500, 1), ('Extra Gravy', 3000, 2)) as a(name, price, s)
     where m.category_name like 'Perf Category %'`,
  // ---------------------------------------------------------------- tables
  `insert into dining_tables (workspace_id, restaurant_id, branch_id, name, capacity, sort_order)
     select b.workspace_id, b.restaurant_id, b.id, 'T' || n, case when n % 3 = 0 then 6 else 4 end, n
     from branches b, generate_series(13, 40) n
     where b.workspace_id = (select workspace_id from perf_ctx) and b.deleted_at is null`,
  `create temp table perf_tables on commit drop as
     select t.id, t.branch_id, t.sort_order as idx
     from dining_tables t where t.workspace_id = (select workspace_id from perf_ctx) and t.deleted_at is null`,
  // ---------------------------------------------------------------- history
  // Day 0 is today (sessions closed at least 2 hours ago); days 1..N are past service days.
  `create temp table perf_sessions on commit drop as
     select gen_random_uuid() as id, b.id as branch_id, b.restaurant_id, d,
       case when d = 0
         then now() - interval '2 hours' - random() * interval '8 hours'
         else ((date_trunc('day', now() at time zone b.timezone) - make_interval(days => d)
               + interval '11 hours' + random() * interval '11 hours') at time zone b.timezone)
       end as opened_at,
       3 + floor(random() * 38)::int as table_idx,
       1 + floor(random() * 4)::int as n_orders
     from branches b, generate_series(0, ${days}) d, generate_series(1, ${perDay}) s
     where b.workspace_id = (select workspace_id from perf_ctx) and b.deleted_at is null`,
  `create temp table perf_orders on commit drop as
     select gen_random_uuid() as id, s.id as session_id, s.branch_id, s.restaurant_id, s.table_idx,
       s.opened_at + make_interval(mins => (k - 1) * 12) + random() * interval '5 minutes' as created_at,
       s.opened_at + make_interval(mins => s.n_orders * 12 + 25) as closed_at,
       random() as r_status, random() as r_lines, 1 + floor(random() * 4)::int as accept_min,
       8 + floor(random() * 23)::int as prep_min
     from perf_sessions s, generate_series(1, s.n_orders) k`,
  `insert into table_sessions (id, workspace_id, restaurant_id, branch_id, table_id, status, opened_at,
       closed_at, created_at, updated_at, version)
     select s.id, (select workspace_id from perf_ctx), s.restaurant_id, s.branch_id, t.id, 'CLOSED',
       s.opened_at, s.opened_at + make_interval(mins => s.n_orders * 12 + 25), s.opened_at,
       s.opened_at + make_interval(mins => s.n_orders * 12 + 25), 4
     from perf_sessions s join perf_tables t on t.branch_id = s.branch_id and t.idx = s.table_idx`,
  `insert into orders (id, workspace_id, restaurant_id, branch_id, table_id, session_id, source,
       order_number, status, currency, subtotal, item_count, idempotency_key, accepted_by, accepted_at,
       preparing_at, ready_at, served_at, served_by, completed_at, rejected_at, rejection_reason,
       cancelled_at, cancellation_reason, version, created_at, updated_at)
     select o.id, (select workspace_id from perf_ctx), o.restaurant_id, o.branch_id, t.id, o.session_id,
       'CUSTOMER', row_number() over (partition by o.branch_id order by o.created_at, o.id)::int,
       st.status, 'INR', 0, 0, o.id::text,
       case when st.accepted then (select waiter_id from perf_ctx) end,
       case when st.accepted then o.created_at + make_interval(mins => o.accept_min) end,
       case when st.status = 'COMPLETED' then o.created_at + make_interval(mins => o.accept_min + 1) end,
       case when st.status = 'COMPLETED' then o.created_at + make_interval(mins => o.accept_min + 1 + o.prep_min) end,
       case when st.status = 'COMPLETED' then o.created_at + make_interval(mins => o.accept_min + 3 + o.prep_min) end,
       case when st.status = 'COMPLETED' then (select waiter_id from perf_ctx) end,
       case when st.status = 'COMPLETED' then o.closed_at end,
       case when st.status = 'REJECTED' then o.created_at + interval '2 minutes' end,
       case when st.status = 'REJECTED' then 'Item unavailable' end,
       case when st.status = 'CANCELLED' then o.created_at + interval '6 minutes' end,
       case when st.status = 'CANCELLED' then 'Guest changed their mind' end,
       5, o.created_at,
       case when st.status = 'COMPLETED' then o.closed_at else o.created_at + interval '6 minutes' end
     from perf_orders o
       join perf_tables t on t.branch_id = o.branch_id and t.idx = o.table_idx,
       lateral (select case when o.r_status < 0.04 then 'REJECTED'
                            when o.r_status < 0.09 then 'CANCELLED' else 'COMPLETED' end as status,
                       o.r_status >= 0.065 as accepted) st`,
  `create temp table perf_lines on commit drop as
     select o.id as order_id, j, 1 + floor(random() * (select count(*) from perf_menu))::int as pick,
       1 + floor(random() * 3)::int as qty, o.created_at
     from perf_orders o, generate_series(1, 1 + floor(o.r_lines * 5)::int) j`,
  `insert into order_items (workspace_id, order_id, menu_item_id, category_name, item_name, dietary,
       base_unit_price, unit_price, quantity, line_total, status, sort_order, created_at, updated_at)
     select (select workspace_id from perf_ctx), l.order_id, m.id, m.category_name, m.name, m.dietary,
       m.price, m.price, l.qty, m.price * l.qty,
       case when ord.status in ('REJECTED','CANCELLED') then 'CANCELLED' else 'SERVED' end,
       l.j, l.created_at, l.created_at
     from perf_lines l join perf_menu m on m.idx = l.pick join orders ord on ord.id = l.order_id`,
  `update orders o set subtotal = x.subtotal, item_count = x.n
     from (select order_id, sum(line_total)::bigint as subtotal, sum(quantity)::int as n
           from order_items oi join perf_orders po on po.id = oi.order_id group by order_id) x
     where o.id = x.order_id`,
  `insert into order_status_history (workspace_id, order_id, from_status, to_status, actor_type,
       actor_user_id, reason, created_at)
     select o.workspace_id, o.id, h.f, h.t, h.a, case when h.a = 'USER' then o.accepted_by end, h.r, h.at
     from orders o join perf_orders po on po.id = o.id,
       lateral (values
         (null, 'PENDING', 'GUEST', null, o.created_at),
         ('PENDING', 'ACCEPTED', 'USER', null, o.accepted_at),
         ('ACCEPTED', 'PREPARING', 'USER', null, o.preparing_at),
         ('PREPARING', 'READY', 'USER', null, o.ready_at),
         ('READY', 'SERVED', 'USER', null, o.served_at),
         ('SERVED', 'COMPLETED', 'SYSTEM', null, o.completed_at),
         ('PENDING', 'REJECTED', 'USER', o.rejection_reason, o.rejected_at),
         (case when o.accepted_at is null then 'PENDING' else 'ACCEPTED' end, 'CANCELLED', 'USER',
           o.cancellation_reason, o.cancelled_at)
       ) as h(f, t, a, r, at)
     where h.at is not null`,
  // ---------------------------------------------------------------- bills
  `create temp table perf_bills on commit drop as
     select gen_random_uuid() as id, s.id as session_id, s.branch_id, s.restaurant_id, ts.table_id,
       sum(o.subtotal)::bigint as subtotal, ts.closed_at
     from perf_sessions s join table_sessions ts on ts.id = s.id
       join orders o on o.session_id = s.id and o.status = 'COMPLETED'
     group by s.id, s.branch_id, s.restaurant_id, ts.table_id, ts.closed_at`,
  `insert into bills (id, workspace_id, restaurant_id, branch_id, table_id, session_id, bill_number,
       status, payment_status, currency, subtotal, prices_include_tax, tax_breakdown, tax_total,
       grand_total, amount_paid, balance_due, issued_by, issued_at, closed_at, version, created_at, updated_at)
     select b.id, (select workspace_id from perf_ctx), b.restaurant_id, b.branch_id, b.table_id, b.session_id,
       row_number() over (partition by b.branch_id order by b.closed_at, b.id)::int,
       'CLOSED', 'PAID', 'INR', b.subtotal, false,
       jsonb_build_array(
         jsonb_build_object('name', 'CGST', 'rateBps', 250, 'amount', round(b.subtotal * 0.025)::bigint),
         jsonb_build_object('name', 'SGST', 'rateBps', 250, 'amount', round(b.subtotal * 0.025)::bigint)),
       2 * round(b.subtotal * 0.025)::bigint, b.subtotal + 2 * round(b.subtotal * 0.025)::bigint,
       b.subtotal + 2 * round(b.subtotal * 0.025)::bigint, 0, (select cashier_id from perf_ctx),
       b.closed_at - interval '8 minutes', b.closed_at, 3, b.closed_at - interval '8 minutes', b.closed_at
     from perf_bills b`,
  `insert into bill_items (workspace_id, bill_id, order_id, order_item_id, order_number, name, quantity,
       unit_price, line_total)
     select oi.workspace_id, b.id, o.id, oi.id, o.order_number, oi.item_name, oi.quantity, oi.unit_price,
       oi.line_total
     from perf_bills b join orders o on o.session_id = b.session_id and o.status = 'COMPLETED'
       join order_items oi on oi.order_id = o.id`,
  `insert into payments (workspace_id, branch_id, bill_id, kind, method, amount, status, idempotency_key,
       recorded_by, created_at)
     select bl.workspace_id, bl.branch_id, bl.id, 'PAYMENT',
       (array['CASH','UPI','UPI','CARD'])[1 + floor(random() * 4)::int], bl.grand_total, 'CONFIRMED',
       gen_random_uuid()::text, bl.issued_by, bl.closed_at - interval '2 minutes'
     from bills bl join perf_bills b on b.id = bl.id where bl.grand_total > 0`,
  `insert into payment_history (workspace_id, bill_id, payment_id, action, amount, balance_before,
       balance_after, payment_status_after, actor_user_id, created_at)
     select p.workspace_id, p.bill_id, p.id, 'RECORDED', p.amount, p.amount, 0, 'PAID', p.recorded_by,
       p.created_at
     from payments p join perf_bills b on b.id = p.bill_id`,
  // ---------------------------------------------------------------- live service (now)
  `create temp table perf_live on commit drop as
     select gen_random_uuid() as id, t.branch_id, t.id as table_id, t.idx,
       now() - make_interval(mins => 20 + floor(random() * 50)::int) as opened_at
     from perf_tables t where t.idx between 3 and 14`,
  `insert into table_sessions (id, workspace_id, restaurant_id, branch_id, table_id, status, opened_at,
       bill_requested_at, created_at, updated_at)
     select l.id, (select workspace_id from perf_ctx), (select restaurant_id from perf_ctx), l.branch_id,
       l.table_id, case when l.idx in (13, 14) then 'BILLED' else 'OPEN' end, l.opened_at,
       case when l.idx in (13, 14) then now() - interval '5 minutes' end, l.opened_at, l.opened_at
     from perf_live l`,
  `create temp table perf_live_orders on commit drop as
     select gen_random_uuid() as id, l.id as session_id, l.branch_id, l.table_id, l.idx, k,
       l.opened_at + make_interval(mins => (k - 1) * 6) as created_at,
       (array['PENDING','ACCEPTED','PREPARING','PREPARING','READY','SERVED'])[1 + floor(random() * 6)::int] as status
     from perf_live l, generate_series(1, 2 + floor(random() * 3)::int) k`,
  `insert into orders (id, workspace_id, restaurant_id, branch_id, table_id, session_id, source,
       order_number, status, currency, subtotal, item_count, idempotency_key, accepted_by, accepted_at,
       preparing_at, ready_at, served_at, version, created_at, updated_at)
     select o.id, (select workspace_id from perf_ctx), (select restaurant_id from perf_ctx), o.branch_id,
       o.table_id, o.session_id, 'CUSTOMER',
       (select coalesce(max(order_number), 0) from orders x where x.branch_id = o.branch_id)
         + row_number() over (partition by o.branch_id order by o.created_at, o.id)::int,
       st.status, 'INR', 0, 0, o.id::text,
       case when st.status <> 'PENDING' then (select waiter_id from perf_ctx) end,
       case when st.status <> 'PENDING' then o.created_at + interval '2 minutes' end,
       case when st.status in ('PREPARING','READY','SERVED') then o.created_at + interval '3 minutes' end,
       case when st.status in ('READY','SERVED') then o.created_at + interval '15 minutes' end,
       case when st.status = 'SERVED' then o.created_at + interval '17 minutes' end,
       3, o.created_at, o.created_at + interval '3 minutes'
     from perf_live_orders o,
       lateral (select case when o.idx in (13, 14) then 'SERVED' else o.status end as status) st`,
  `insert into order_items (workspace_id, order_id, menu_item_id, category_name, item_name, dietary,
       base_unit_price, unit_price, quantity, line_total, status, sort_order, created_at, updated_at)
     select (select workspace_id from perf_ctx), o.id, m.id, m.category_name, m.name, m.dietary, m.price,
       m.price, 1 + (j % 2), m.price * (1 + (j % 2)),
       case when ord.status = 'SERVED' then 'SERVED' when ord.status = 'READY' then 'READY'
            when ord.status = 'PREPARING' then 'PREPARING' else 'PENDING' end, j, o.created_at, o.created_at
     from perf_live_orders o join orders ord on ord.id = o.id, generate_series(1, 3) j,
       lateral (select * from perf_menu where idx = 1 + ((abs(hashtext(o.id::text || j)) % (select count(*) from perf_menu))::int)) m`,
  `update orders o set subtotal = x.subtotal, item_count = x.n
     from (select order_id, sum(line_total)::bigint as subtotal, sum(quantity)::int as n
           from order_items oi join perf_live_orders po on po.id = oi.order_id group by order_id) x
     where o.id = x.order_id`,
  `insert into order_status_history (workspace_id, order_id, from_status, to_status, actor_type, created_at)
     select o.workspace_id, o.id, null, 'PENDING', 'GUEST', o.created_at
     from orders o join perf_live_orders po on po.id = o.id`,
  `insert into bills (workspace_id, restaurant_id, branch_id, table_id, session_id, bill_number, status,
       payment_status, currency, subtotal, prices_include_tax, tax_breakdown, tax_total, grand_total,
       amount_paid, balance_due, issued_by, issued_at)
     select s.workspace_id, s.restaurant_id, s.branch_id, s.table_id, s.id,
       (select coalesce(max(bill_number), 0) from bills x where x.branch_id = s.branch_id)
         + row_number() over (partition by s.branch_id order by s.id)::int,
       'ISSUED', 'UNPAID', 'INR', x.subtotal, false,
       jsonb_build_array(
         jsonb_build_object('name', 'CGST', 'rateBps', 250, 'amount', round(x.subtotal * 0.025)::bigint),
         jsonb_build_object('name', 'SGST', 'rateBps', 250, 'amount', round(x.subtotal * 0.025)::bigint)),
       2 * round(x.subtotal * 0.025)::bigint, x.subtotal + 2 * round(x.subtotal * 0.025)::bigint, 0,
       x.subtotal + 2 * round(x.subtotal * 0.025)::bigint, (select cashier_id from perf_ctx), now() - interval '4 minutes'
     from table_sessions s
       join (select session_id, sum(subtotal)::bigint as subtotal from orders group by session_id) x
         on x.session_id = s.id
     where s.status = 'BILLED' and s.workspace_id = (select workspace_id from perf_ctx)`,
  `insert into bill_items (workspace_id, bill_id, order_id, order_item_id, order_number, name, quantity,
       unit_price, line_total)
     select oi.workspace_id, bl.id, o.id, oi.id, o.order_number, oi.item_name, oi.quantity, oi.unit_price,
       oi.line_total
     from bills bl join orders o on o.session_id = bl.session_id join order_items oi on oi.order_id = o.id
     where bl.status = 'ISSUED' and bl.workspace_id = (select workspace_id from perf_ctx)`,
  // ---------------------------------------------------------------- counters
  `insert into branch_counters (branch_id, name, value)
     select branch_id, 'order', max(order_number) from orders
     where workspace_id = (select workspace_id from perf_ctx) group by branch_id
     on conflict (branch_id, name) do update set value = excluded.value`,
  `insert into branch_counters (branch_id, name, value)
     select branch_id, 'bill', max(bill_number) from bills
     where workspace_id = (select workspace_id from perf_ctx) group by branch_id
     on conflict (branch_id, name) do update set value = excluded.value`,
];

async function count(db: Executor, table: string): Promise<number> {
  const res = (await db.execute(`select count(*)::int as n from ${table}`)) as unknown as {
    rows: { n: number }[];
  };
  return res.rows[0]!.n;
}

async function main() {
  const url = process.env.PERF_DATABASE_URL;
  const dir = process.env.PGLITE_DATA_DIR ?? "";
  if (!url && dir && existsSync(path.join(dir, "postgresql.conf"))) {
    // Throwaway perf directory only: cap WAL so the bulk load does not leave ~200 MB of segments.
    appendFileSync(
      path.join(dir, "postgresql.conf"),
      "\n# perf harness\nmax_wal_size = 32MB\nmin_wal_size = 32MB\n",
    );
  }
  const handle = url ? await connectPostgres(url, 1) : await connectPglite(dir);
  try {
    const db = handle.db;
    if ((await count(db, "menu_categories where name like 'Perf Category %'")) > 0) {
      console.log("perf dataset already present; nothing to do");
      return;
    }
    const started = performance.now();
    await db.transaction(async (tx) => {
      for (const statement of STATEMENTS(DAYS, SESSIONS_PER_DAY)) await tx.execute(statement);
    });
    await db.execute("analyze");
    await db.execute("checkpoint");
    const tables = [
      "menu_items",
      "menu_variants",
      "addons",
      "dining_tables",
      "table_sessions",
      "orders",
      "order_items",
      "order_status_history",
      "bills",
      "bill_items",
      "payments",
    ];
    const counts: Record<string, number> = {};
    for (const t of tables) counts[t] = await count(db, t);
    console.log(
      JSON.stringify({
        seconds: Math.round((performance.now() - started) / 100) / 10,
        days: DAYS,
        sessionsPerDayPerBranch: SESSIONS_PER_DAY,
        rows: counts,
      }),
    );
  } finally {
    await handle.close();
  }
}

main().catch((error: unknown) => {
  const e = error as { message?: string; cause?: { message?: string; detail?: string } };
  console.error(e.cause?.message ?? e.message ?? error, e.cause?.detail ?? "");
  process.exit(1);
});
