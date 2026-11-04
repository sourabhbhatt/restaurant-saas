import { and, asc, eq, inArray, isNull, ne, notInArray, sql } from "drizzle-orm";

import type { GuestBillDto } from "@/contracts/billing";
import type { GuestOrderStepDto, GuestOrderViewDto } from "@/contracts/ordering";
import type { OrderItemAddonDto } from "@/contracts/orders";
import type { PaymentStatus } from "@/domain/billing/payments";
import type { OrderStatus } from "@/domain/orders/order-status";
import type {
  GuestRecord,
  OrderingRepository,
  SessionRecord,
  TableContext,
} from "@/server/modules/ordering/ports";

import type { Executor } from "../client";
import {
  billItems,
  bills,
  branchCounters,
  branchSettings,
  branches,
  diningTables,
  orderItemAddons,
  orderItems,
  orderStatusHistory,
  orders,
  restaurantSettings,
  restaurants,
  tableQrTokens,
  tableSessionMembers,
  tableSessions,
  workspaces,
} from "../schema";
import { loadBranchMenu } from "./menu";
import { notifyBranchStaff } from "./notifications";
import { staffOpsRepository } from "./staff-ops";

/**
 * Ordering adapter (customer QR + staff order placement). Every query filters
 * by ids that the service resolved server-side (QR hash, guest token hash or a
 * branch scope); guest reads are additionally filtered by the member id.
 */

const tableContextColumns = {
  workspaceId: diningTables.workspaceId,
  restaurantId: diningTables.restaurantId,
  branchId: diningTables.branchId,
  tableId: diningTables.id,
  tableName: diningTables.name,
  tableActive: diningTables.isActive,
  tableDeletedAt: diningTables.deletedAt,
  branchName: branches.name,
  branchStatus: branches.status,
  branchDeletedAt: branches.deletedAt,
  currency: branches.currency,
  restaurantName: restaurants.name,
  restaurantStatus: restaurants.status,
  restaurantDeletedAt: restaurants.deletedAt,
  description: restaurants.description,
  logoKey: restaurants.logoKey,
  coverKey: restaurants.coverKey,
  brandColor: restaurants.brandColor,
  workspaceStatus: workspaces.status,
  workspaceDeletedAt: workspaces.deletedAt,
  welcomeMessage: restaurantSettings.welcomeMessage,
  showPrepTime: restaurantSettings.showPrepTime,
  showAllergens: restaurantSettings.showAllergens,
  acceptingOrders: branchSettings.acceptingOrders,
  allowCustomerBillRequest: branchSettings.allowCustomerBillRequest,
};

function tableContextQuery(db: Executor) {
  return db
    .select(tableContextColumns)
    .from(diningTables)
    .innerJoin(
      branches,
      and(
        eq(branches.id, diningTables.branchId),
        eq(branches.workspaceId, diningTables.workspaceId),
      ),
    )
    .innerJoin(
      restaurants,
      and(
        eq(restaurants.id, diningTables.restaurantId),
        eq(restaurants.workspaceId, diningTables.workspaceId),
        eq(branches.restaurantId, restaurants.id),
      ),
    )
    .innerJoin(workspaces, eq(workspaces.id, diningTables.workspaceId))
    .leftJoin(restaurantSettings, eq(restaurantSettings.restaurantId, restaurants.id))
    .leftJoin(branchSettings, eq(branchSettings.branchId, branches.id));
}

type TableContextRow = Awaited<ReturnType<typeof tableContextQuery>>[number];

function toTableContext(row: TableContextRow): TableContext {
  const operational =
    row.tableActive &&
    row.tableDeletedAt === null &&
    row.branchStatus === "ACTIVE" &&
    row.branchDeletedAt === null &&
    row.restaurantStatus === "ACTIVE" &&
    row.restaurantDeletedAt === null &&
    row.workspaceStatus === "ACTIVE" &&
    row.workspaceDeletedAt === null;
  return {
    workspaceId: row.workspaceId,
    restaurantId: row.restaurantId,
    branchId: row.branchId,
    tableId: row.tableId,
    tableName: row.tableName,
    branchName: row.branchName,
    restaurantName: row.restaurantName,
    currency: row.currency,
    restaurant: {
      description: row.description,
      logoKey: row.logoKey,
      coverKey: row.coverKey,
      brandColor: row.brandColor,
      welcomeMessage: row.welcomeMessage ?? null,
      showPrepTime: row.showPrepTime ?? true,
      showAllergens: row.showAllergens ?? true,
    },
    // A branch without a settings row uses the column defaults.
    acceptingOrders: row.acceptingOrders ?? true,
    allowCustomerBillRequest: row.allowCustomerBillRequest ?? true,
    operational,
  };
}

function toSession(row: typeof tableSessions.$inferSelect): SessionRecord {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    restaurantId: row.restaurantId,
    branchId: row.branchId,
    tableId: row.tableId,
    status: row.status,
    openedAt: row.openedAt,
    billRequestedAt: row.billRequestedAt,
    version: row.version,
  };
}

function timelineOf(row: typeof orders.$inferSelect): GuestOrderStepDto[] {
  const steps: [OrderStatus, Date | null][] = [
    ["PENDING", row.createdAt],
    ["ACCEPTED", row.acceptedAt],
    ["PREPARING", row.preparingAt],
    ["READY", row.readyAt],
    ["SERVED", row.servedAt],
    ["COMPLETED", row.completedAt],
    ["REJECTED", row.rejectedAt],
    ["CANCELLED", row.cancelledAt],
  ];
  return steps
    .filter((s): s is [OrderStatus, Date] => s[1] !== null)
    .map(([status, at]) => ({ status, at: at.toISOString() }));
}

async function hydrateGuestOrders(
  db: Executor,
  workspaceId: string,
  rows: (typeof orders.$inferSelect)[],
): Promise<GuestOrderViewDto[]> {
  if (rows.length === 0) return [];
  const itemRows = await db
    .select()
    .from(orderItems)
    .where(
      and(
        eq(orderItems.workspaceId, workspaceId),
        inArray(
          orderItems.orderId,
          rows.map((r) => r.id),
        ),
      ),
    )
    .orderBy(asc(orderItems.sortOrder));
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
  const addonsByItem = new Map<string, OrderItemAddonDto[]>();
  for (const a of addonRows) {
    const list = addonsByItem.get(a.orderItemId) ?? [];
    list.push({ groupName: a.groupName, name: a.addonName, price: a.price });
    addonsByItem.set(a.orderItemId, list);
  }
  const itemsByOrder = new Map<string, GuestOrderViewDto["items"]>();
  for (const i of itemRows) {
    const list = itemsByOrder.get(i.orderId) ?? [];
    list.push({
      itemName: i.itemName,
      variantName: i.variantName,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
      notes: i.notes,
      addons: addonsByItem.get(i.id) ?? [],
    });
    itemsByOrder.set(i.orderId, list);
  }
  return rows.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status as OrderStatus,
    currency: o.currency,
    subtotal: o.subtotal,
    rejectionReason: o.rejectionReason,
    createdAt: o.createdAt.toISOString(),
    updatedAt: o.updatedAt.toISOString(),
    items: itemsByOrder.get(o.id) ?? [],
    timeline: timelineOf(o),
  }));
}

export function orderingRepository(
  db: Executor,
  options: { imageUrl?: (key: string) => string } = {},
): OrderingRepository {
  async function tableById(tableId: string): Promise<TableContext | null> {
    const [row] = await tableContextQuery(db).where(eq(diningTables.id, tableId)).limit(1);
    return row ? toTableContext(row) : null;
  }

  return {
    async findTableByQrHash(tokenHash) {
      const [row] = await tableContextQuery(db)
        .innerJoin(
          tableQrTokens,
          and(
            eq(tableQrTokens.tableId, diningTables.id),
            eq(tableQrTokens.workspaceId, diningTables.workspaceId),
            eq(tableQrTokens.branchId, diningTables.branchId),
          ),
        )
        .where(and(eq(tableQrTokens.tokenHash, tokenHash), eq(tableQrTokens.status, "ACTIVE")))
        .limit(1);
      return row ? toTableContext(row) : null;
    },

    async findTableInBranch(target, tableId) {
      const [row] = await tableContextQuery(db)
        .where(
          and(
            eq(diningTables.id, tableId),
            eq(diningTables.workspaceId, target.workspaceId),
            eq(diningTables.restaurantId, target.restaurantId),
            eq(diningTables.branchId, target.branchId),
            isNull(diningTables.deletedAt),
          ),
        )
        .limit(1);
      return row ? toTableContext(row) : null;
    },

    async findOpenSession(workspaceId, tableId) {
      const [row] = await db
        .select()
        .from(tableSessions)
        .where(
          and(
            eq(tableSessions.workspaceId, workspaceId),
            eq(tableSessions.tableId, tableId),
            ne(tableSessions.status, "CLOSED"),
          ),
        )
        .limit(1);
      return row ? toSession(row) : null;
    },

    async lockSession(workspaceId, sessionId) {
      const [row] = await db
        .select()
        .from(tableSessions)
        .where(and(eq(tableSessions.workspaceId, workspaceId), eq(tableSessions.id, sessionId)))
        .limit(1)
        .for("update");
      return row ? toSession(row) : null;
    },

    async sessionHasActiveOrders(workspaceId, sessionId) {
      const [row] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(
          and(
            eq(orders.workspaceId, workspaceId),
            eq(orders.sessionId, sessionId),
            notInArray(orders.status, ["REJECTED", "CANCELLED"]),
          ),
        )
        .limit(1);
      return Boolean(row);
    },

    async tryInsertSession({ target, tableId, openedBy }) {
      // ON CONFLICT DO NOTHING (no target) also covers the partial unique index
      // table_sessions_one_open_uq, so a concurrent opener simply loses.
      const [row] = await db
        .insert(tableSessions)
        .values({
          workspaceId: target.workspaceId,
          restaurantId: target.restaurantId,
          branchId: target.branchId,
          tableId,
          status: "OPEN",
          openedBy,
        })
        .onConflictDoNothing()
        .returning();
      return row ? toSession(row) : null;
    },

    async findGuestByTokenHash(tokenHash) {
      const [row] = await db
        .select({ memberId: tableSessionMembers.id, session: tableSessions })
        .from(tableSessionMembers)
        .innerJoin(
          tableSessions,
          and(
            eq(tableSessions.id, tableSessionMembers.sessionId),
            eq(tableSessions.workspaceId, tableSessionMembers.workspaceId),
          ),
        )
        .where(eq(tableSessionMembers.guestTokenHash, tokenHash))
        .limit(1);
      if (!row) return null;
      const table = await tableById(row.session.tableId);
      if (!table || table.workspaceId !== row.session.workspaceId) return null;
      const guest: GuestRecord = { memberId: row.memberId, session: toSession(row.session), table };
      return guest;
    },

    async insertMember(input) {
      const [row] = await db
        .insert(tableSessionMembers)
        .values({
          workspaceId: input.workspaceId,
          sessionId: input.sessionId,
          guestTokenHash: input.guestTokenHash,
        })
        .returning({ id: tableSessionMembers.id });
      return row!.id;
    },

    async touchMember(memberId, now) {
      await db
        .update(tableSessionMembers)
        .set({ lastSeenAt: now })
        .where(eq(tableSessionMembers.id, memberId));
    },

    async nextCounter(branchId, name) {
      const [row] = await db
        .insert(branchCounters)
        .values({ branchId, name, value: 1 })
        .onConflictDoUpdate({
          target: [branchCounters.branchId, branchCounters.name],
          set: { value: sql`${branchCounters.value} + 1` },
        })
        .returning({ value: branchCounters.value });
      return row!.value;
    },

    async findOrderByIdempotencyKey(branchId, key) {
      const [row] = await db
        .select({
          id: orders.id,
          source: orders.source,
          memberId: orders.memberId,
          placedByUserId: orders.placedByUserId,
          sessionId: orders.sessionId,
        })
        .from(orders)
        .where(and(eq(orders.branchId, branchId), eq(orders.idempotencyKey, key)))
        .limit(1);
      return row ?? null;
    },

    async insertOrder(input) {
      const [order] = await db
        .insert(orders)
        .values({
          workspaceId: input.target.workspaceId,
          restaurantId: input.target.restaurantId,
          branchId: input.target.branchId,
          tableId: input.tableId,
          sessionId: input.sessionId,
          memberId: input.memberId,
          placedByUserId: input.placedByUserId,
          source: input.source,
          orderNumber: input.orderNumber,
          status: input.status,
          priority: input.priority,
          specialInstructions: input.specialInstructions,
          currency: input.currency,
          subtotal: input.subtotal,
          itemCount: input.itemCount,
          idempotencyKey: input.idempotencyKey,
          acceptedBy: input.acceptedBy,
          acceptedAt: input.acceptedAt,
        })
        .onConflictDoNothing({ target: [orders.branchId, orders.idempotencyKey] })
        .returning({ id: orders.id });
      if (!order) return null;

      const lineRows = await db
        .insert(orderItems)
        .values(
          input.lines.map((l, index) => ({
            workspaceId: input.target.workspaceId,
            orderId: order.id,
            menuItemId: l.itemId,
            variantId: l.variantId,
            categoryName: l.categoryName,
            itemName: l.itemName,
            variantName: l.variantName,
            dietary: l.dietary,
            baseUnitPrice: l.baseUnitPrice,
            addonsUnitTotal: l.addonsUnitTotal,
            unitPrice: l.unitPrice,
            quantity: l.quantity,
            lineTotal: l.lineTotal,
            notes: l.notes,
            status: "PENDING",
            sortOrder: index,
          })),
        )
        .returning({ id: orderItems.id, sortOrder: orderItems.sortOrder });

      const addonValues = lineRows.flatMap((row) =>
        (input.lines[row.sortOrder]?.addons ?? []).map((a) => ({
          workspaceId: input.target.workspaceId,
          orderItemId: row.id,
          addonId: a.id,
          groupName: a.groupName,
          addonName: a.name,
          price: a.price,
        })),
      );
      if (addonValues.length) await db.insert(orderItemAddons).values(addonValues);

      await db.insert(orderStatusHistory).values(
        input.history.map((h) => ({
          workspaceId: input.target.workspaceId,
          orderId: order.id,
          fromStatus: h.fromStatus,
          toStatus: h.toStatus,
          actorType: h.actorType,
          actorUserId: h.actorUserId,
        })),
      );
      return order.id;
    },

    async getGuestOrder(workspaceId, sessionId, memberId, orderId) {
      const rows = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.workspaceId, workspaceId),
            eq(orders.sessionId, sessionId),
            eq(orders.memberId, memberId),
            eq(orders.id, orderId),
          ),
        )
        .limit(1);
      const [dto] = await hydrateGuestOrders(db, workspaceId, rows);
      return dto ?? null;
    },

    async listGuestOrders(workspaceId, sessionId, memberId) {
      const rows = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.workspaceId, workspaceId),
            eq(orders.sessionId, sessionId),
            eq(orders.memberId, memberId),
          ),
        )
        .orderBy(asc(orders.createdAt));
      return hydrateGuestOrders(db, workspaceId, rows);
    },

    async getStaffOrder(target, orderId) {
      return staffOpsRepository(db).getOrderDto(target, orderId, { timeline: true });
    },

    async findLiveBillForSession(workspaceId, sessionId): Promise<GuestBillDto | null> {
      const [bill] = await db
        .select()
        .from(bills)
        .where(
          and(
            eq(bills.workspaceId, workspaceId),
            eq(bills.sessionId, sessionId),
            ne(bills.status, "VOID"),
          ),
        )
        .limit(1);
      if (!bill) return null;
      const items = await db
        .select()
        .from(billItems)
        .where(and(eq(billItems.workspaceId, workspaceId), eq(billItems.billId, bill.id)))
        .orderBy(asc(billItems.orderNumber), asc(billItems.name));
      return {
        billNumber: bill.billNumber,
        currency: bill.currency,
        paymentStatus: bill.paymentStatus as PaymentStatus,
        amountPaid: bill.amountPaid,
        balanceDue: bill.balanceDue,
        subtotal: bill.subtotal,
        discountAmount: bill.discountAmount,
        serviceChargeBps: bill.serviceChargeBps,
        serviceChargeAmount: bill.serviceChargeAmount,
        taxes: bill.taxBreakdown,
        taxTotal: bill.taxTotal,
        grandTotal: bill.grandTotal,
        pricesIncludeTax: bill.pricesIncludeTax,
        items: items.map((i) => ({
          orderNumber: i.orderNumber,
          name: i.name,
          variantName: i.variantName,
          addonsSummary: i.addonsSummary,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          lineTotal: i.lineTotal,
        })),
      };
    },

    async markBillRequested(session, now) {
      const [row] = await db
        .update(tableSessions)
        .set({
          status: "BILL_REQUESTED",
          billRequestedAt: now,
          version: sql`${tableSessions.version} + 1`,
        })
        .where(
          and(
            eq(tableSessions.workspaceId, session.workspaceId),
            eq(tableSessions.id, session.id),
            eq(tableSessions.status, "OPEN"),
            eq(tableSessions.version, session.version),
          ),
        )
        .returning();
      return row ? toSession(row) : null;
    },

    loadMenu(target, opts) {
      return loadBranchMenu(db, target, {
        includeUnavailable: opts.includeUnavailable,
        imageUrl: options.imageUrl,
      });
    },

    notifyBranchStaff(target, permission, input) {
      return notifyBranchStaff(db, target, permission, input);
    },
  };
}
