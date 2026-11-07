import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { OrderDto, OrderItemDto, OrderStatusEventDto } from "@ros/contracts/orders";
import type {
  KitchenOrderDto,
  SessionBillSummaryDto,
  TableSessionSummaryDto,
} from "@ros/contracts/staff-ops";
import type { PaymentStatus } from "@ros/domain/billing/payments";
import {
  ACTIVE_ORDER_STATUSES,
  BILLABLE_ORDER_STATUSES,
  KITCHEN_STATUSES,
  type OrderItemStatus,
  type OrderPriority,
  type OrderStatus,
} from "@ros/domain/orders/order-status";
import type { SessionStatus } from "@ros/domain/tables/table-status";
import type {
  BranchTarget,
  OrderRecord,
  StaffOpsRepository,
} from "@ros/application/modules/staff-ops/ports";

import type { Executor } from "../client";
import {
  bills,
  branchSettings,
  diningTables,
  menuItems,
  orderItemAddons,
  orderItems,
  orderStatusHistory,
  orders,
  tableSessions,
  users,
} from "../schema";
import { notifyUsers, usersWithPermissionAtBranch } from "./notifications";

const acceptedByUser = alias(users, "accepted_by_user");
const placedByUser = alias(users, "placed_by_user");

const orderColumns = {
  id: orders.id,
  workspaceId: orders.workspaceId,
  restaurantId: orders.restaurantId,
  branchId: orders.branchId,
  tableId: orders.tableId,
  tableName: diningTables.name,
  sessionId: orders.sessionId,
  orderNumber: orders.orderNumber,
  source: orders.source,
  status: orders.status,
  priority: orders.priority,
  specialInstructions: orders.specialInstructions,
  currency: orders.currency,
  subtotal: orders.subtotal,
  itemCount: orders.itemCount,
  rejectionReason: orders.rejectionReason,
  cancellationReason: orders.cancellationReason,
  acceptedByName: acceptedByUser.name,
  placedByName: placedByUser.name,
  createdAt: orders.createdAt,
  acceptedAt: orders.acceptedAt,
  preparingAt: orders.preparingAt,
  readyAt: orders.readyAt,
  servedAt: orders.servedAt,
  completedAt: orders.completedAt,
  version: orders.version,
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function scoped(target: BranchTarget) {
  return and(eq(orders.workspaceId, target.workspaceId), eq(orders.branchId, target.branchId));
}

function toRecord(row: typeof orders.$inferSelect): OrderRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    restaurantId: row.restaurantId,
    branchId: row.branchId,
    tableId: row.tableId,
    sessionId: row.sessionId,
    orderNumber: row.orderNumber,
    status: row.status as OrderStatus,
    priority: row.priority as OrderPriority,
    version: row.version,
  };
}

export function staffOpsRepository(db: Executor): StaffOpsRepository {
  function baseOrderQuery() {
    return db
      .select(orderColumns)
      .from(orders)
      .innerJoin(diningTables, eq(diningTables.id, orders.tableId))
      .leftJoin(acceptedByUser, eq(acceptedByUser.id, orders.acceptedBy))
      .leftJoin(placedByUser, eq(placedByUser.id, orders.placedByUserId));
  }

  type OrderRow = Awaited<ReturnType<ReturnType<typeof baseOrderQuery>["execute"]>>[number];

  async function hydrate(
    workspaceId: string,
    rows: OrderRow[],
    opts: { timeline?: boolean } = {},
  ): Promise<OrderDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const itemRows = await db
      .select()
      .from(orderItems)
      .where(and(eq(orderItems.workspaceId, workspaceId), inArray(orderItems.orderId, ids)))
      .orderBy(asc(orderItems.sortOrder), asc(orderItems.createdAt));
    const addonRows = itemRows.length
      ? await db
          .select()
          .from(orderItemAddons)
          .where(
            and(
              eq(orderItemAddons.workspaceId, workspaceId),
              inArray(
                orderItemAddons.orderItemId,
                itemRows.map((i) => i.id),
              ),
            ),
          )
      : [];
    const addonsByItem = new Map<string, OrderItemDto["addons"]>();
    for (const a of addonRows) {
      const list = addonsByItem.get(a.orderItemId) ?? [];
      list.push({ groupName: a.groupName, name: a.addonName, price: a.price });
      addonsByItem.set(a.orderItemId, list);
    }
    const itemsByOrder = new Map<string, OrderItemDto[]>();
    for (const i of itemRows) {
      const list = itemsByOrder.get(i.orderId) ?? [];
      list.push({
        id: i.id,
        menuItemId: i.menuItemId,
        itemName: i.itemName,
        variantName: i.variantName,
        dietary: i.dietary,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
        notes: i.notes,
        status: i.status as OrderItemStatus,
        addons: addonsByItem.get(i.id) ?? [],
      });
      itemsByOrder.set(i.orderId, list);
    }

    const timelines = new Map<string, OrderStatusEventDto[]>();
    if (opts.timeline) {
      const historyUser = alias(users, "history_user");
      const hist = await db
        .select({
          orderId: orderStatusHistory.orderId,
          fromStatus: orderStatusHistory.fromStatus,
          toStatus: orderStatusHistory.toStatus,
          actorType: orderStatusHistory.actorType,
          actorName: historyUser.name,
          reason: orderStatusHistory.reason,
          createdAt: orderStatusHistory.createdAt,
        })
        .from(orderStatusHistory)
        .leftJoin(historyUser, eq(historyUser.id, orderStatusHistory.actorUserId))
        .where(
          and(
            eq(orderStatusHistory.workspaceId, workspaceId),
            inArray(orderStatusHistory.orderId, ids),
          ),
        )
        .orderBy(asc(orderStatusHistory.createdAt));
      for (const h of hist) {
        const list = timelines.get(h.orderId) ?? [];
        list.push({
          fromStatus: (h.fromStatus as OrderStatus | null) ?? null,
          toStatus: h.toStatus as OrderStatus,
          actorType: h.actorType,
          actorName: h.actorName,
          reason: h.reason,
          at: h.createdAt.toISOString(),
        });
        timelines.set(h.orderId, list);
      }
    }

    return rows.map((row) => {
      const dto: OrderDto = {
        id: row.id,
        branchId: row.branchId,
        tableId: row.tableId,
        tableName: row.tableName,
        sessionId: row.sessionId,
        orderNumber: row.orderNumber,
        source: row.source,
        status: row.status as OrderStatus,
        priority: row.priority as OrderPriority,
        specialInstructions: row.specialInstructions,
        currency: row.currency,
        subtotal: row.subtotal,
        itemCount: row.itemCount,
        rejectionReason: row.rejectionReason,
        cancellationReason: row.cancellationReason,
        acceptedByName: row.acceptedByName,
        createdAt: row.createdAt.toISOString(),
        acceptedAt: iso(row.acceptedAt),
        preparingAt: iso(row.preparingAt),
        readyAt: iso(row.readyAt),
        servedAt: iso(row.servedAt),
        completedAt: iso(row.completedAt),
        version: row.version,
        items: itemsByOrder.get(row.id) ?? [],
      };
      if (opts.timeline) {
        const events = timelines.get(row.id) ?? [];
        // Orders created before history was recorded still show their creation.
        if (!events.some((e) => e.fromStatus === null)) {
          events.unshift({
            fromStatus: null,
            toStatus: "PENDING",
            actorType: row.source === "STAFF" ? "USER" : "GUEST",
            actorName: row.source === "STAFF" ? row.placedByName : null,
            reason: null,
            at: row.createdAt.toISOString(),
          });
        }
        dto.timeline = events;
      }
      return dto;
    });
  }

  async function sessionSummaries(
    target: BranchTarget,
    sessions: {
      id: string;
      status: string;
      openedAt: Date;
      billRequestedAt: Date | null;
    }[],
  ): Promise<{
    summaries: Map<string, TableSessionSummaryDto>;
    bills: Map<string, SessionBillSummaryDto>;
  }> {
    const summaries = new Map<string, TableSessionSummaryDto>();
    const billMap = new Map<string, SessionBillSummaryDto>();
    if (sessions.length === 0) return { summaries, bills: billMap };
    const ids = sessions.map((s) => s.id);
    const counts = await db
      .select({
        sessionId: orders.sessionId,
        status: orders.status,
        n: sql<number>`count(*)::int`,
        subtotal: sql<number>`coalesce(sum(${orders.subtotal}), 0)::bigint`,
      })
      .from(orders)
      .where(and(scoped(target), inArray(orders.sessionId, ids)))
      .groupBy(orders.sessionId, orders.status);
    for (const s of sessions) {
      summaries.set(s.id, {
        id: s.id,
        status: s.status as SessionStatus,
        openedAt: s.openedAt.toISOString(),
        billRequestedAt: iso(s.billRequestedAt),
        orderCounts: {},
        pendingCount: 0,
        activeCount: 0,
        billableSubtotal: 0,
      });
    }
    for (const c of counts) {
      const summary = summaries.get(c.sessionId);
      if (!summary) continue;
      const status = c.status as OrderStatus;
      summary.orderCounts[status] = c.n;
      if (status === "PENDING") summary.pendingCount += c.n;
      if (ACTIVE_ORDER_STATUSES.includes(status)) summary.activeCount += c.n;
      if (BILLABLE_ORDER_STATUSES.includes(status)) summary.billableSubtotal += Number(c.subtotal);
    }
    const billRows = await db
      .select({
        id: bills.id,
        sessionId: bills.sessionId,
        billNumber: bills.billNumber,
        status: bills.status,
        paymentStatus: bills.paymentStatus,
        currency: bills.currency,
        grandTotal: bills.grandTotal,
        balanceDue: bills.balanceDue,
      })
      .from(bills)
      .where(
        and(
          eq(bills.workspaceId, target.workspaceId),
          eq(bills.branchId, target.branchId),
          inArray(bills.sessionId, ids),
          ne(bills.status, "VOID"),
        ),
      );
    for (const b of billRows) {
      billMap.set(b.sessionId, {
        billId: b.id,
        billNumber: b.billNumber,
        status: b.status as SessionBillSummaryDto["status"],
        paymentStatus: b.paymentStatus as PaymentStatus,
        currency: b.currency,
        grandTotal: b.grandTotal,
        balanceDue: b.balanceDue,
      });
    }
    return { summaries, bills: billMap };
  }

  return {
    async findOrderBranchId(orderId) {
      if (!/^[0-9a-f-]{36}$/i.test(orderId)) return null;
      const [row] = await db
        .select({ branchId: orders.branchId })
        .from(orders)
        .where(eq(orders.id, orderId))
        .limit(1);
      return row?.branchId ?? null;
    },

    async findOrder(target, orderId, opts = {}) {
      const q = db
        .select()
        .from(orders)
        .where(and(scoped(target), eq(orders.id, orderId)))
        .limit(1);
      const [row] = opts.lock ? await q.for("update") : await q;
      return row ? toRecord(row) : null;
    },

    async getOrderDto(target, orderId, opts = {}) {
      const rows = await baseOrderQuery()
        .where(and(scoped(target), eq(orders.id, orderId)))
        .limit(1);
      const [dto] = await hydrate(target.workspaceId, rows, opts);
      return dto ?? null;
    },

    async listOrders(target, filter) {
      const rows = await baseOrderQuery()
        .where(
          and(
            scoped(target),
            filter.status?.length ? inArray(orders.status, filter.status) : undefined,
            filter.sessionId ? eq(orders.sessionId, filter.sessionId) : undefined,
            filter.tableId ? eq(orders.tableId, filter.tableId) : undefined,
            filter.from ? gte(orders.createdAt, new Date(filter.from)) : undefined,
            filter.to ? lte(orders.createdAt, new Date(filter.to)) : undefined,
            filter.orderNumber ? eq(orders.orderNumber, filter.orderNumber) : undefined,
          ),
        )
        .orderBy(desc(orders.createdAt), desc(orders.orderNumber))
        .limit(filter.limit);
      return hydrate(target.workspaceId, rows);
    },

    async listSessionOrders(target, sessionId) {
      const rows = await baseOrderQuery()
        .where(and(scoped(target), eq(orders.sessionId, sessionId)))
        .orderBy(desc(orders.createdAt), desc(orders.orderNumber));
      return hydrate(target.workspaceId, rows);
    },

    async transitionOrder(target, orderId, input) {
      const p = input.patch;
      const [row] = await db
        .update(orders)
        .set({
          status: input.to,
          version: sql`${orders.version} + 1`,
          ...(p.acceptedAt ? { acceptedAt: p.acceptedAt } : {}),
          ...(p.acceptedBy ? { acceptedBy: p.acceptedBy } : {}),
          ...(p.preparingAt ? { preparingAt: p.preparingAt } : {}),
          ...(p.readyAt ? { readyAt: p.readyAt } : {}),
          ...(p.servedAt ? { servedAt: p.servedAt } : {}),
          ...(p.servedBy ? { servedBy: p.servedBy } : {}),
          ...(p.completedAt ? { completedAt: p.completedAt } : {}),
          ...(p.rejectedAt ? { rejectedAt: p.rejectedAt } : {}),
          ...(p.rejectionReason ? { rejectionReason: p.rejectionReason } : {}),
          ...(p.cancelledAt ? { cancelledAt: p.cancelledAt } : {}),
          ...(p.cancellationReason ? { cancellationReason: p.cancellationReason } : {}),
        })
        .where(
          and(
            scoped(target),
            eq(orders.id, orderId),
            eq(orders.status, input.from),
            eq(orders.version, input.expectedVersion),
          ),
        )
        .returning();
      return row ? toRecord(row) : null;
    },

    async setItemStatuses(target, orderId, status, onlyFrom) {
      await db
        .update(orderItems)
        .set({ status })
        .where(
          and(
            eq(orderItems.workspaceId, target.workspaceId),
            eq(orderItems.orderId, orderId),
            onlyFrom?.length ? inArray(orderItems.status, [...onlyFrom]) : undefined,
          ),
        );
    },

    async listOrderItems(target, orderId) {
      const rows = await db
        .select({ id: orderItems.id, orderId: orderItems.orderId, status: orderItems.status })
        .from(orderItems)
        .where(
          and(eq(orderItems.workspaceId, target.workspaceId), eq(orderItems.orderId, orderId)),
        );
      return rows.map((r) => ({ ...r, status: r.status as OrderItemStatus }));
    },

    async updateItemStatus(target, orderId, itemId, from, to) {
      const rows = await db
        .update(orderItems)
        .set({ status: to })
        .where(
          and(
            eq(orderItems.workspaceId, target.workspaceId),
            eq(orderItems.orderId, orderId),
            eq(orderItems.id, itemId),
            eq(orderItems.status, from),
          ),
        )
        .returning({ id: orderItems.id });
      return rows.length === 1;
    },

    async updatePriority(target, orderId, priority, expectedVersion) {
      const [row] = await db
        .update(orders)
        .set({ priority, version: sql`${orders.version} + 1` })
        .where(and(scoped(target), eq(orders.id, orderId), eq(orders.version, expectedVersion)))
        .returning();
      return row ? toRecord(row) : null;
    },

    async insertStatusHistory(input) {
      await db.insert(orderStatusHistory).values({
        workspaceId: input.workspaceId,
        orderId: input.orderId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        actorType: "USER",
        actorUserId: input.actorUserId,
        reason: input.reason,
      });
    },

    async branchSettings(target) {
      const [row] = await db
        .select({
          kitchenDelayMinutes: branchSettings.kitchenDelayMinutes,
          kitchenSoundEnabled: branchSettings.kitchenSoundEnabled,
          waiterSoundEnabled: branchSettings.waiterSoundEnabled,
        })
        .from(branchSettings)
        .where(
          and(
            eq(branchSettings.branchId, target.branchId),
            eq(branchSettings.workspaceId, target.workspaceId),
          ),
        )
        .limit(1);
      return (
        row ?? { kitchenDelayMinutes: 20, kitchenSoundEnabled: true, waiterSoundEnabled: true }
      );
    },

    async kitchenFeed(target, recentSince, fallbackPrepMinutes) {
      const activeRows = await baseOrderQuery()
        .where(and(scoped(target), inArray(orders.status, [...KITCHEN_STATUSES])))
        .orderBy(asc(sql`coalesce(${orders.acceptedAt}, ${orders.createdAt})`))
        .limit(200);
      const recentRows = await baseOrderQuery()
        .where(
          and(
            scoped(target),
            or(
              and(
                inArray(orders.status, ["SERVED", "COMPLETED"]),
                gte(
                  sql`coalesce(${orders.servedAt}, ${orders.completedAt}, ${orders.updatedAt})`,
                  recentSince,
                ),
              ),
              and(
                eq(orders.status, "CANCELLED"),
                isNotNull(orders.acceptedAt),
                gte(orders.cancelledAt, recentSince),
              ),
            ),
          ),
        )
        .orderBy(desc(orders.updatedAt))
        .limit(50);
      const [active, recent] = await Promise.all([
        hydrate(target.workspaceId, activeRows),
        hydrate(target.workspaceId, recentRows),
      ]);
      const ids = [...active, ...recent].map((o) => o.id);
      const prep = new Map<string, number>();
      if (ids.length) {
        const rows = await db
          .select({
            orderId: orderItems.orderId,
            minutes: sql<number | null>`max(${menuItems.prepTimeMinutes})::int`,
          })
          .from(orderItems)
          .innerJoin(menuItems, eq(menuItems.id, orderItems.menuItemId))
          .where(
            and(
              eq(orderItems.workspaceId, target.workspaceId),
              inArray(orderItems.orderId, ids),
              ne(orderItems.status, "CANCELLED"),
            ),
          )
          .groupBy(orderItems.orderId);
        for (const r of rows) if (r.minutes != null) prep.set(r.orderId, r.minutes);
      }
      const withPrep = (o: OrderDto): KitchenOrderDto => ({
        ...o,
        expectedPrepMinutes: prep.get(o.id) ?? fallbackPrepMinutes,
      });
      return { active: active.map(withPrep), recent: recent.map(withPrep) };
    },

    async listBranchTables(target) {
      const tables = await db
        .select({
          id: diningTables.id,
          name: diningTables.name,
          section: diningTables.section,
          capacity: diningTables.capacity,
          isActive: diningTables.isActive,
        })
        .from(diningTables)
        .where(
          and(
            eq(diningTables.workspaceId, target.workspaceId),
            eq(diningTables.branchId, target.branchId),
            isNull(diningTables.deletedAt),
          ),
        )
        .orderBy(asc(diningTables.sortOrder), asc(diningTables.name));
      const sessions = await db
        .select({
          id: tableSessions.id,
          tableId: tableSessions.tableId,
          status: tableSessions.status,
          openedAt: tableSessions.openedAt,
          billRequestedAt: tableSessions.billRequestedAt,
        })
        .from(tableSessions)
        .where(
          and(
            eq(tableSessions.workspaceId, target.workspaceId),
            eq(tableSessions.branchId, target.branchId),
            ne(tableSessions.status, "CLOSED"),
          ),
        );
      const { summaries, bills: billMap } = await sessionSummaries(target, sessions);
      const byTable = new Map(sessions.map((s) => [s.tableId, s.id]));
      return tables.map((t) => {
        const sessionId = byTable.get(t.id);
        return {
          tableId: t.id,
          tableName: t.name,
          section: t.section,
          capacity: t.capacity,
          isActive: t.isActive,
          session: sessionId ? (summaries.get(sessionId) ?? null) : null,
          bill: sessionId ? (billMap.get(sessionId) ?? null) : null,
        };
      });
    },

    async findSession(target, sessionId) {
      if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return null;
      const [row] = await db
        .select({
          id: tableSessions.id,
          status: tableSessions.status,
          openedAt: tableSessions.openedAt,
          billRequestedAt: tableSessions.billRequestedAt,
          tableId: diningTables.id,
          tableName: diningTables.name,
          tableSection: diningTables.section,
          tableCapacity: diningTables.capacity,
          tableIsActive: diningTables.isActive,
        })
        .from(tableSessions)
        .innerJoin(diningTables, eq(diningTables.id, tableSessions.tableId))
        .where(
          and(
            eq(tableSessions.id, sessionId),
            eq(tableSessions.workspaceId, target.workspaceId),
            eq(tableSessions.branchId, target.branchId),
          ),
        )
        .limit(1);
      if (!row) return null;
      const { summaries, bills: billMap } = await sessionSummaries(target, [row]);
      return {
        id: row.id,
        tableId: row.tableId,
        tableName: row.tableName,
        tableSection: row.tableSection,
        tableCapacity: row.tableCapacity,
        tableIsActive: row.tableIsActive,
        summary: summaries.get(row.id)!,
        bill: billMap.get(row.id) ?? null,
      };
    },

    async notifyBranch(target, permission, input, excludeUserIds = []) {
      const exclude = new Set(excludeUserIds);
      const userIds = (await usersWithPermissionAtBranch(db, target, permission)).filter(
        (id) => !exclude.has(id),
      );
      return notifyUsers(
        db,
        userIds,
        { workspaceId: target.workspaceId, branchId: target.branchId },
        input,
      );
    },
  };
}
