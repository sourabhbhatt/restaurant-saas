import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";

import { addDaysIso } from "@/domain/analytics/date-range";
import type {
  AnalyticsBranch,
  AnalyticsRepository,
  BranchSelection,
  DateWindow,
  LiveSnapshot,
  OrderTotals,
} from "@/server/modules/analytics/ports";

import type { Executor } from "../client";
import {
  branchSettings,
  branches,
  restaurants,
  subscriptionPlans,
  subscriptions,
  workspaces,
} from "../schema";

/**
 * Reporting queries. Every tenant query is bounded by the scope-derived
 * `BranchSelection` (workspace id AND explicit branch ids) and buckets
 * timestamps in each branch's own IANA time zone, read from `branches.timezone`
 * via a join — the zone is never taken from client input. Money is summed as
 * bigint and converted to number (minor units).
 */

const VALID = sql.raw(`('REJECTED','CANCELLED')`);

async function rows<T>(db: Executor, query: SQL): Promise<T[]> {
  const res = (await db.execute(query)) as unknown as { rows: T[] };
  return res.rows;
}

const num = (v: unknown): number => (v === null || v === undefined ? 0 : Number(v));
const minutes = (v: unknown): number | null =>
  v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10;

/** `<alias>.workspace_id = ws and <alias>.branch_id in (...)` */
function inSelection(alias: string, sel: BranchSelection): SQL {
  const a = sql.raw(alias);
  return sql`${a}.workspace_id = ${sel.workspaceId}::uuid and ${a}.branch_id in (${sql.join(
    sel.branchIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )})`;
}

/**
 * Timestamp column within the local-date window of branch `b`. The UTC bounds
 * (±1 day covers every UTC offset) keep the branch/created_at indexes usable;
 * the local-date test is exact.
 */
function inWindow(column: string, w: DateWindow): SQL {
  const c = sql.raw(column);
  const lo = `${addDaysIso(w.from, -1)}T00:00:00Z`;
  const hi = `${addDaysIso(w.to, 2)}T00:00:00Z`;
  return sql`${c} >= ${lo}::timestamptz and ${c} < ${hi}::timestamptz and (${c} at time zone b.timezone)::date between ${w.from}::date and ${w.to}::date`;
}

function localDay(column: string): SQL {
  return sql`to_char((${sql.raw(column)} at time zone b.timezone)::date, 'YYYY-MM-DD')`;
}

const EMPTY_ORDERS: OrderTotals = {
  totalOrders: 0,
  validOrders: 0,
  completedOrders: 0,
  cancelledOrders: 0,
  orderValue: 0,
};

export function analyticsRepository(db: Executor): AnalyticsRepository {
  return {
    async listBranches(workspaceId) {
      const list = await db
        .select({
          id: branches.id,
          name: branches.name,
          code: branches.code,
          restaurantId: branches.restaurantId,
          restaurantName: restaurants.name,
          timezone: branches.timezone,
          currency: branches.currency,
          status: branches.status,
          kitchenDelayMinutes: branchSettings.kitchenDelayMinutes,
          businessHours: branches.businessHours,
        })
        .from(branches)
        .innerJoin(restaurants, eq(restaurants.id, branches.restaurantId))
        .leftJoin(branchSettings, eq(branchSettings.branchId, branches.id))
        .where(
          and(
            eq(branches.workspaceId, workspaceId),
            isNull(branches.deletedAt),
            isNull(restaurants.deletedAt),
          ),
        )
        .orderBy(restaurants.name, branches.name);
      return list.map(
        (b): AnalyticsBranch => ({
          ...b,
          kitchenDelayMinutes: b.kitchenDelayMinutes ?? 20,
          businessHours: Array.isArray(b.businessHours) ? b.businessHours : [],
        }),
      );
    },

    async orderTotals(sel, w) {
      if (!sel.branchIds.length) return EMPTY_ORDERS;
      const [r] = await rows<Record<string, unknown>>(
        db,
        sql`select count(*)::int as total,
          count(*) filter (where o.status not in ${VALID})::int as valid,
          count(*) filter (where o.status in ('SERVED','COMPLETED'))::int as completed,
          count(*) filter (where o.status in ${VALID})::int as cancelled,
          coalesce(sum(o.subtotal) filter (where o.status not in ${VALID}), 0)::bigint as value
        from orders o join branches b on b.id = o.branch_id
        where ${inSelection("o", sel)} and ${inWindow("o.created_at", w)}`,
      );
      return {
        totalOrders: num(r?.total),
        validOrders: num(r?.valid),
        completedOrders: num(r?.completed),
        cancelledOrders: num(r?.cancelled),
        orderValue: num(r?.value),
      };
    },

    async billTotals(sel, w) {
      const empty = {
        billed: 0,
        billCount: 0,
        discounts: 0,
        outstanding: 0,
        unpaidBills: 0,
        partiallyPaidBills: 0,
      };
      if (!sel.branchIds.length) return empty;
      const [r] = await rows<Record<string, unknown>>(
        db,
        sql`select coalesce(sum(bl.grand_total), 0)::bigint as billed,
          count(*)::int as bill_count,
          coalesce(sum(bl.discount_amount), 0)::bigint as discounts,
          coalesce(sum(bl.balance_due) filter (where bl.payment_status in ('UNPAID','PARTIALLY_PAID')), 0)::bigint as outstanding,
          count(*) filter (where bl.payment_status = 'UNPAID')::int as unpaid,
          count(*) filter (where bl.payment_status = 'PARTIALLY_PAID')::int as partial
        from bills bl join branches b on b.id = bl.branch_id
        where ${inSelection("bl", sel)} and bl.status <> 'VOID' and ${inWindow("bl.issued_at", w)}`,
      );
      return {
        billed: num(r?.billed),
        billCount: num(r?.bill_count),
        discounts: num(r?.discounts),
        outstanding: num(r?.outstanding),
        unpaidBills: num(r?.unpaid),
        partiallyPaidBills: num(r?.partial),
      };
    },

    async paymentTotals(sel, w) {
      if (!sel.branchIds.length) return { byMethod: [], voidedPayments: 0 };
      const list = await rows<Record<string, unknown>>(
        db,
        sql`select p.method,
          coalesce(sum(p.amount) filter (where p.kind = 'PAYMENT' and p.status = 'CONFIRMED'), 0)::bigint as payments,
          count(*) filter (where p.kind = 'PAYMENT' and p.status = 'CONFIRMED')::int as payment_count,
          coalesce(sum(p.amount) filter (where p.kind = 'REFUND' and p.status = 'CONFIRMED'), 0)::bigint as refunds,
          count(*) filter (where p.kind = 'REFUND' and p.status = 'CONFIRMED')::int as refund_count,
          count(*) filter (where p.status = 'VOIDED')::int as voided
        from payments p join branches b on b.id = p.branch_id
        where ${inSelection("p", sel)} and ${inWindow("p.created_at", w)}
        group by p.method
        order by payments desc, p.method`,
      );
      return {
        byMethod: list.map((r) => ({
          method: String(r.method),
          payments: num(r.payments),
          paymentCount: num(r.payment_count),
          refunds: num(r.refunds),
          refundCount: num(r.refund_count),
        })),
        voidedPayments: list.reduce((s, r) => s + num(r.voided), 0),
      };
    },

    async daily(sel, w) {
      if (!sel.branchIds.length) return [];
      const [o, bl, p] = await Promise.all([
        rows<Record<string, unknown>>(
          db,
          sql`select ${localDay("o.created_at")} as d, count(*)::int as orders,
            count(*) filter (where o.status not in ${VALID})::int as valid,
            coalesce(sum(o.subtotal) filter (where o.status not in ${VALID}), 0)::bigint as value
          from orders o join branches b on b.id = o.branch_id
          where ${inSelection("o", sel)} and ${inWindow("o.created_at", w)}
          group by 1`,
        ),
        rows<Record<string, unknown>>(
          db,
          sql`select ${localDay("bl.issued_at")} as d, coalesce(sum(bl.grand_total), 0)::bigint as billed
          from bills bl join branches b on b.id = bl.branch_id
          where ${inSelection("bl", sel)} and bl.status <> 'VOID' and ${inWindow("bl.issued_at", w)}
          group by 1`,
        ),
        rows<Record<string, unknown>>(
          db,
          sql`select ${localDay("p.created_at")} as d,
            coalesce(sum(case when p.kind = 'PAYMENT' then p.amount else -p.amount end), 0)::bigint as net
          from payments p join branches b on b.id = p.branch_id
          where ${inSelection("p", sel)} and p.status = 'CONFIRMED' and ${inWindow("p.created_at", w)}
          group by 1`,
        ),
      ]);
      const byDate = new Map<
        string,
        {
          date: string;
          orders: number;
          validOrders: number;
          orderValue: number;
          billed: number;
          collected: number;
        }
      >();
      const at = (d: unknown) => {
        const key = String(d);
        let row = byDate.get(key);
        if (!row) {
          row = { date: key, orders: 0, validOrders: 0, orderValue: 0, billed: 0, collected: 0 };
          byDate.set(key, row);
        }
        return row;
      };
      for (const r of o) {
        const row = at(r.d);
        row.orders = num(r.orders);
        row.validOrders = num(r.valid);
        row.orderValue = num(r.value);
      }
      for (const r of bl) at(r.d).billed = num(r.billed);
      for (const r of p) at(r.d).collected = num(r.net);
      return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
    },

    async peakHours(sel, w) {
      if (!sel.branchIds.length) return [];
      const list = await rows<Record<string, unknown>>(
        db,
        sql`select extract(dow from (o.created_at at time zone b.timezone))::int as weekday,
          extract(hour from (o.created_at at time zone b.timezone))::int as hour,
          count(*)::int as orders
        from orders o join branches b on b.id = o.branch_id
        where ${inSelection("o", sel)} and ${inWindow("o.created_at", w)}
        group by 1, 2
        order by 1, 2`,
      );
      return list.map((r) => ({
        weekday: num(r.weekday),
        hour: num(r.hour),
        orders: num(r.orders),
      }));
    },

    async topItems(sel, w, limit) {
      if (!sel.branchIds.length) return [];
      const list = await rows<Record<string, unknown>>(
        db,
        sql`select oi.item_name as name, max(oi.category_name) as category,
          sum(oi.quantity)::int as quantity, coalesce(sum(oi.line_total), 0)::bigint as revenue,
          count(distinct oi.order_id)::int as orders
        from order_items oi
          join orders o on o.id = oi.order_id
          join branches b on b.id = o.branch_id
        where ${inSelection("o", sel)} and oi.workspace_id = ${sel.workspaceId}::uuid
          and o.status not in ${VALID} and ${inWindow("o.created_at", w)}
        group by oi.item_name
        order by quantity desc, revenue desc, name
        limit ${limit}`,
      );
      return list.map((r) => ({
        name: String(r.name),
        category: r.category === null || r.category === undefined ? null : String(r.category),
        quantity: num(r.quantity),
        revenue: num(r.revenue),
        orders: num(r.orders),
      }));
    },

    async categories(sel, w) {
      if (!sel.branchIds.length) return [];
      const list = await rows<Record<string, unknown>>(
        db,
        sql`select coalesce(oi.category_name, 'Uncategorized') as category,
          sum(oi.quantity)::int as quantity, coalesce(sum(oi.line_total), 0)::bigint as revenue,
          count(distinct oi.item_name)::int as items
        from order_items oi
          join orders o on o.id = oi.order_id
          join branches b on b.id = o.branch_id
        where ${inSelection("o", sel)} and oi.workspace_id = ${sel.workspaceId}::uuid
          and o.status not in ${VALID} and ${inWindow("o.created_at", w)}
        group by 1
        order by revenue desc, category`,
      );
      return list.map((r) => ({
        category: String(r.category),
        quantity: num(r.quantity),
        revenue: num(r.revenue),
        items: num(r.items),
      }));
    },

    async tableUsage(sel, w, now) {
      if (!sel.branchIds.length) return [];
      const nowIso = now.toISOString();
      const list = await rows<Record<string, unknown>>(
        db,
        sql`select t.id, t.name, t.section, t.capacity,
          count(s.id)::int as sessions,
          count(s.closed_at)::int as closed_sessions,
          (avg(extract(epoch from (s.closed_at - s.opened_at)) / 60) filter (where s.closed_at is not null))::float8 as avg_minutes,
          coalesce(sum(greatest(extract(epoch from (coalesce(s.closed_at, ${nowIso}::timestamptz) - s.opened_at)), 0) / 60), 0)::float8 as occupied
        from dining_tables t
          join branches b on b.id = t.branch_id
          left join table_sessions s on s.table_id = t.id and s.workspace_id = t.workspace_id
            and ${inWindow("s.opened_at", w)}
        where ${inSelection("t", sel)} and t.deleted_at is null
        group by t.id, t.name, t.section, t.capacity, t.sort_order
        order by t.sort_order, t.name`,
      );
      return list.map((r) => ({
        tableId: String(r.id),
        name: String(r.name),
        section: r.section === null || r.section === undefined ? null : String(r.section),
        capacity: num(r.capacity),
        sessions: num(r.sessions),
        closedSessions: num(r.closed_sessions),
        avgSessionMinutes: minutes(r.avg_minutes),
        occupiedMinutes: Math.round(num(r.occupied)),
      }));
    },

    async kitchenTotals(sel, w, now) {
      const empty = {
        avgPrepMinutes: null,
        avgWaitMinutes: null,
        delayedOrders: 0,
        ordersCompleted: 0,
        ordersAccepted: 0,
      };
      if (!sel.branchIds.length) return empty;
      const nowIso = now.toISOString();
      const [r] = await rows<Record<string, unknown>>(
        db,
        sql`select
          (avg(extract(epoch from (o.ready_at - o.accepted_at)) / 60) filter (where o.ready_at is not null and o.accepted_at is not null))::float8 as avg_prep,
          (avg(extract(epoch from (o.accepted_at - o.created_at)) / 60) filter (where o.accepted_at is not null))::float8 as avg_wait,
          count(*) filter (where o.accepted_at is not null and (
            (o.ready_at is not null and o.ready_at - o.accepted_at > make_interval(mins => coalesce(bs.kitchen_delay_minutes, 20)))
            or (o.ready_at is null and o.status in ('ACCEPTED','PREPARING')
                and ${nowIso}::timestamptz - o.accepted_at > make_interval(mins => coalesce(bs.kitchen_delay_minutes, 20)))
          ))::int as delayed,
          count(*) filter (where o.ready_at is not null)::int as completed,
          count(*) filter (where o.accepted_at is not null)::int as accepted
        from orders o
          join branches b on b.id = o.branch_id
          left join branch_settings bs on bs.branch_id = o.branch_id
        where ${inSelection("o", sel)} and ${inWindow("o.created_at", w)}`,
      );
      return {
        avgPrepMinutes: minutes(r?.avg_prep),
        avgWaitMinutes: minutes(r?.avg_wait),
        delayedOrders: num(r?.delayed),
        ordersCompleted: num(r?.completed),
        ordersAccepted: num(r?.accepted),
      };
    },

    async kitchenItems(sel, w, limit) {
      if (!sel.branchIds.length) return [];
      const list = await rows<Record<string, unknown>>(
        db,
        sql`select oi.item_name as name, count(distinct o.id)::int as orders, sum(oi.quantity)::int as quantity,
          (avg(extract(epoch from (o.ready_at - o.accepted_at)) / 60) filter (where o.ready_at is not null))::float8 as avg_prep
        from order_items oi
          join orders o on o.id = oi.order_id
          join branches b on b.id = o.branch_id
        where ${inSelection("o", sel)} and oi.workspace_id = ${sel.workspaceId}::uuid
          and o.accepted_at is not null and ${inWindow("o.created_at", w)}
        group by oi.item_name
        order by orders desc, name
        limit ${limit}`,
      );
      return list.map((r) => ({
        name: String(r.name),
        orders: num(r.orders),
        quantity: num(r.quantity),
        avgPrepMinutes: minutes(r.avg_prep),
      }));
    },

    async perBranch(sel, w) {
      if (!sel.branchIds.length) return [];
      const [o, bl, p] = await Promise.all([
        rows<Record<string, unknown>>(
          db,
          sql`select o.branch_id, count(*)::int as total,
            count(*) filter (where o.status not in ${VALID})::int as valid,
            count(*) filter (where o.status in ('SERVED','COMPLETED'))::int as completed,
            count(*) filter (where o.status in ${VALID})::int as cancelled,
            coalesce(sum(o.subtotal) filter (where o.status not in ${VALID}), 0)::bigint as value,
            (avg(extract(epoch from (o.ready_at - o.accepted_at)) / 60) filter (where o.ready_at is not null and o.accepted_at is not null))::float8 as avg_prep
          from orders o join branches b on b.id = o.branch_id
          where ${inSelection("o", sel)} and ${inWindow("o.created_at", w)}
          group by o.branch_id`,
        ),
        rows<Record<string, unknown>>(
          db,
          sql`select bl.branch_id, coalesce(sum(bl.grand_total), 0)::bigint as billed
          from bills bl join branches b on b.id = bl.branch_id
          where ${inSelection("bl", sel)} and bl.status <> 'VOID' and ${inWindow("bl.issued_at", w)}
          group by bl.branch_id`,
        ),
        rows<Record<string, unknown>>(
          db,
          sql`select p.branch_id,
            coalesce(sum(case when p.kind = 'PAYMENT' then p.amount else -p.amount end), 0)::bigint as net
          from payments p join branches b on b.id = p.branch_id
          where ${inSelection("p", sel)} and p.status = 'CONFIRMED' and ${inWindow("p.created_at", w)}
          group by p.branch_id`,
        ),
      ]);
      const billed = new Map(bl.map((r) => [String(r.branch_id), num(r.billed)]));
      const collected = new Map(p.map((r) => [String(r.branch_id), num(r.net)]));
      const orders = new Map(o.map((r) => [String(r.branch_id), r]));
      return sel.branchIds.map((branchId) => {
        const r = orders.get(branchId);
        return {
          branchId,
          totalOrders: num(r?.total),
          validOrders: num(r?.valid),
          completedOrders: num(r?.completed),
          cancelledOrders: num(r?.cancelled),
          orderValue: num(r?.value),
          avgPrepMinutes: minutes(r?.avg_prep),
          billed: billed.get(branchId) ?? 0,
          collected: collected.get(branchId) ?? 0,
        };
      });
    },

    async pendingNow(sel) {
      if (!sel.branchIds.length) return 0;
      const [r] = await rows<Record<string, unknown>>(
        db,
        sql`select count(*)::int as n from orders o where ${inSelection("o", sel)} and o.status = 'PENDING'`,
      );
      return num(r?.n);
    },

    async live(sel, today) {
      const empty: LiveSnapshot = {
        pendingOrders: 0,
        inKitchen: 0,
        readyOrders: 0,
        ordersToday: 0,
        activeTables: 0,
        billRequested: 0,
        totalTables: 0,
        openBills: 0,
        outstanding: 0,
        collectedToday: 0,
      };
      if (!sel.branchIds.length) return empty;
      const day: DateWindow = { from: today, to: today };
      const [o, t, bl, p] = await Promise.all([
        rows<Record<string, unknown>>(
          db,
          sql`select count(*) filter (where o.status = 'PENDING')::int as pending,
            count(*) filter (where o.status in ('ACCEPTED','PREPARING'))::int as kitchen,
            count(*) filter (where o.status = 'READY')::int as ready,
            count(*) filter (where (o.created_at at time zone b.timezone)::date = ${today}::date)::int as today
          from orders o join branches b on b.id = o.branch_id
          where ${inSelection("o", sel)}
            and (o.status in ('PENDING','ACCEPTED','PREPARING','READY')
              or o.created_at >= ${`${addDaysIso(today, -1)}T00:00:00Z`}::timestamptz)`,
        ),
        rows<Record<string, unknown>>(
          db,
          sql`select
            (select count(*) from dining_tables t where ${inSelection("t", sel)} and t.deleted_at is null and t.is_active)::int as total,
            (select count(*) from table_sessions s where ${inSelection("s", sel)} and s.status <> 'CLOSED')::int as active,
            (select count(*) from table_sessions s where ${inSelection("s", sel)} and s.status = 'BILL_REQUESTED')::int as requested`,
        ),
        rows<Record<string, unknown>>(
          db,
          sql`select count(*)::int as open, coalesce(sum(bl.balance_due), 0)::bigint as outstanding
          from bills bl
          where ${inSelection("bl", sel)} and bl.status = 'ISSUED'
            and bl.payment_status in ('UNPAID','PARTIALLY_PAID')`,
        ),
        rows<Record<string, unknown>>(
          db,
          sql`select coalesce(sum(case when p.kind = 'PAYMENT' then p.amount else -p.amount end), 0)::bigint as net
          from payments p join branches b on b.id = p.branch_id
          where ${inSelection("p", sel)} and p.status = 'CONFIRMED' and ${inWindow("p.created_at", day)}`,
        ),
      ]);
      return {
        pendingOrders: num(o[0]?.pending),
        inKitchen: num(o[0]?.kitchen),
        readyOrders: num(o[0]?.ready),
        ordersToday: num(o[0]?.today),
        totalTables: num(t[0]?.total),
        activeTables: num(t[0]?.active),
        billRequested: num(t[0]?.requested),
        openBills: num(bl[0]?.open),
        outstanding: num(bl[0]?.outstanding),
        collectedToday: num(p[0]?.net),
      };
    },

    // ------------------------------------------------------------ platform

    async platformCounts() {
      const [byStatus, totals] = await Promise.all([
        rows<Record<string, unknown>>(
          db,
          sql`select status, count(*)::int as n from workspaces where deleted_at is null group by status`,
        ),
        rows<Record<string, unknown>>(
          db,
          sql`select
            (select count(*) from restaurants r join workspaces w on w.id = r.workspace_id
              where r.deleted_at is null and w.deleted_at is null)::int as restaurants,
            (select count(*) from branches br join workspaces w on w.id = br.workspace_id
              where br.deleted_at is null and w.deleted_at is null)::int as branches,
            (select count(*) from users where disabled_at is null)::int as users`,
        ),
      ]);
      const status: Record<string, number> = {};
      for (const r of byStatus) status[String(r.status)] = num(r.n);
      return {
        workspaces: Object.values(status).reduce((a, b) => a + b, 0),
        byStatus: status,
        restaurants: num(totals[0]?.restaurants),
        branches: num(totals[0]?.branches),
        users: num(totals[0]?.users),
      };
    },

    async workspaceSubscriptions() {
      const list = await db
        .select({
          workspaceId: workspaces.id,
          workspaceStatus: workspaces.status,
          sub: {
            id: subscriptions.id,
            status: subscriptions.status,
            trialStartsAt: subscriptions.trialStartsAt,
            trialEndsAt: subscriptions.trialEndsAt,
            currentPeriodEnd: subscriptions.currentPeriodEnd,
            cancelledAt: subscriptions.cancelledAt,
          },
          plan: {
            id: subscriptionPlans.id,
            key: subscriptionPlans.key,
            name: subscriptionPlans.name,
            limits: subscriptionPlans.limits,
            features: subscriptionPlans.features,
          },
        })
        .from(workspaces)
        .leftJoin(
          subscriptions,
          and(eq(subscriptions.workspaceId, workspaces.id), eq(subscriptions.isCurrent, true)),
        )
        .leftJoin(subscriptionPlans, eq(subscriptionPlans.id, subscriptions.planId))
        .where(isNull(workspaces.deletedAt));
      return list.map((r) => ({
        workspaceId: r.workspaceId,
        workspaceStatus: r.workspaceStatus,
        subscription: r.sub?.id
          ? {
              status: r.sub.status,
              trialStartsAt: r.sub.trialStartsAt,
              trialEndsAt: r.sub.trialEndsAt,
              currentPeriodEnd: r.sub.currentPeriodEnd,
              cancelledAt: r.sub.cancelledAt,
            }
          : null,
        plan: r.plan?.id
          ? {
              id: r.plan.id,
              key: r.plan.key,
              name: r.plan.name,
              limits: r.plan.limits,
              features: r.plan.features,
            }
          : null,
      }));
    },

    async recentWorkspaces(limit) {
      return db
        .select({
          id: workspaces.id,
          name: workspaces.name,
          slug: workspaces.slug,
          status: workspaces.status,
          createdAt: workspaces.createdAt,
          restaurants: sql<number>`(select count(*) from restaurants r where r.workspace_id = ${workspaces.id} and r.deleted_at is null)`.mapWith(
            Number,
          ),
          branches: sql<number>`(select count(*) from branches br where br.workspace_id = ${workspaces.id} and br.deleted_at is null)`.mapWith(
            Number,
          ),
          members: sql<number>`(select count(*) from workspace_memberships m where m.workspace_id = ${workspaces.id} and m.status = 'ACTIVE')`.mapWith(
            Number,
          ),
        })
        .from(workspaces)
        .where(isNull(workspaces.deletedAt))
        .orderBy(desc(workspaces.createdAt))
        .limit(limit);
    },

    async workspacesCreatedSince(since) {
      const list = await rows<Record<string, unknown>>(
        db,
        sql`select to_char(date_trunc('week', created_at at time zone 'UTC'), 'YYYY-MM-DD') as wk, count(*)::int as n
        from workspaces where deleted_at is null and created_at >= ${since.toISOString()}::timestamptz
        group by 1 order by 1`,
      );
      return list.map((r) => ({ weekStart: String(r.wk), count: num(r.n) }));
    },

    async workspacesCreatedBefore(before) {
      const [r] = await rows<Record<string, unknown>>(
        db,
        sql`select count(*)::int as n from workspaces
        where deleted_at is null and created_at < ${before.toISOString()}::timestamptz`,
      );
      return num(r?.n);
    },

    async trialConversion() {
      const [r] = await rows<Record<string, unknown>>(
        db,
        sql`with t as (
          select workspace_id, min(created_at) as started from subscription_events
          where type = 'trial_started' group by workspace_id
        )
        select (select count(*) from t)::int as started,
          (select count(distinct t.workspace_id) from t
            join subscription_events e on e.workspace_id = t.workspace_id
              and e.to_status = 'ACTIVE' and e.created_at >= t.started)::int as converted`,
      );
      return { trialsStarted: num(r?.started), converted: num(r?.converted) };
    },

    async ordersPerDay(since) {
      const list = await rows<Record<string, unknown>>(
        db,
        sql`select to_char((created_at at time zone 'UTC')::date, 'YYYY-MM-DD') as d, count(*)::int as n
        from orders where created_at >= ${since.toISOString()}::timestamptz
        group by 1 order by 1`,
      );
      return list.map((r) => ({ date: String(r.d), orders: num(r.n) }));
    },

    async activeSince(since) {
      const [r] = await rows<Record<string, unknown>>(
        db,
        sql`select count(distinct branch_id)::int as branches, count(distinct workspace_id)::int as workspaces
        from orders where created_at >= ${since.toISOString()}::timestamptz`,
      );
      return { branches: num(r?.branches), workspaces: num(r?.workspaces) };
    },
  };
}
