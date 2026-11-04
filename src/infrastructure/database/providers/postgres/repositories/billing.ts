import { and, asc, desc, eq, gte, inArray, lt, ne, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { BillDto, BillItemDto, PaymentDto } from "@/contracts/billing";
import type { BillListItemDto, SessionAwaitingBillDto } from "@/contracts/billing-extra";
import { buildBillLines, countSessionOrders, type SnapshotOrder } from "@/domain/billing/bill-lines";
import {
  PAYMENT_METHODS,
  type BillStatus,
  type PaymentKind,
  type PaymentMethod,
  type PaymentStatus,
} from "@/domain/billing/payments";
import type { OrderStatus } from "@/domain/orders/order-status";
import { sum } from "@/domain/shared/money";
import type {
  BillingRepository,
  BillRecord,
  BranchBillingSettings,
  BranchKey,
  PaymentRecord,
} from "@/server/modules/billing/ports";

import type { Executor } from "../client";
import {
  billItems,
  bills,
  branches,
  branchCounters,
  branchSettings,
  diningTables,
  orderItemAddons,
  orderItems,
  orderStatusHistory,
  orders,
  payments,
  paymentHistory,
  restaurants,
  tableSessions,
  users,
  workspaces,
} from "../schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEFAULT_SETTINGS: BranchBillingSettings = {
  taxes: [],
  pricesIncludeTax: false,
  serviceChargeBps: 0,
  paymentMethods: ["CASH", "UPI", "CARD"],
  requireFullPaymentToClose: true,
  autoCompleteOnPayment: true,
};

const issuer = alias(users, "bill_issuer");
const recorder = alias(users, "payment_recorder");

const billScope = (key: BranchKey) =>
  and(eq(bills.workspaceId, key.workspaceId), eq(bills.branchId, key.branchId));

const itemCountSql = sql<number>`(select count(*)::int from ${billItems} where ${billItems.billId} = ${bills.id})`;

function toBillRecord(row: typeof bills.$inferSelect & { itemCount: number }): BillRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    tableId: row.tableId,
    billNumber: row.billNumber,
    status: row.status as BillStatus,
    paymentStatus: row.paymentStatus as PaymentStatus,
    subtotal: row.subtotal,
    discountType: row.discountType,
    discountValue: row.discountValue,
    discountAmount: row.discountAmount,
    serviceChargeAmount: row.serviceChargeAmount,
    taxTotal: row.taxTotal,
    grandTotal: row.grandTotal,
    amountPaid: row.amountPaid,
    amountRefunded: row.amountRefunded,
    balanceDue: row.balanceDue,
    itemCount: Number(row.itemCount),
    version: row.version,
  };
}

function toPaymentRecord(row: typeof payments.$inferSelect): PaymentRecord {
  return {
    id: row.id,
    billId: row.billId,
    kind: row.kind,
    method: row.method,
    amount: row.amount,
    tendered: row.tendered,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
  };
}

const listColumns = {
  id: bills.id,
  billNumber: bills.billNumber,
  tableId: bills.tableId,
  tableName: diningTables.name,
  sessionId: bills.sessionId,
  status: bills.status,
  paymentStatus: bills.paymentStatus,
  currency: bills.currency,
  grandTotal: bills.grandTotal,
  amountPaid: bills.amountPaid,
  amountRefunded: bills.amountRefunded,
  balanceDue: bills.balanceDue,
  issuedAt: bills.issuedAt,
  issuedByName: issuer.name,
  closedAt: bills.closedAt,
};

interface ListRow {
  id: string;
  billNumber: number;
  tableId: string;
  tableName: string;
  sessionId: string;
  status: string;
  paymentStatus: string;
  currency: string;
  grandTotal: number;
  amountPaid: number;
  amountRefunded: number;
  balanceDue: number;
  issuedAt: Date;
  issuedByName: string | null;
  closedAt: Date | null;
}

function toListItem(row: ListRow): BillListItemDto {
  return {
    id: row.id,
    billNumber: row.billNumber,
    tableId: row.tableId,
    tableName: row.tableName,
    sessionId: row.sessionId,
    status: row.status as BillStatus,
    paymentStatus: row.paymentStatus as PaymentStatus,
    currency: row.currency,
    grandTotal: row.grandTotal,
    amountPaid: row.amountPaid,
    amountRefunded: row.amountRefunded,
    balanceDue: row.balanceDue,
    issuedAt: row.issuedAt.toISOString(),
    issuedByName: row.issuedByName,
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

export function billingRepository(db: Executor): BillingRepository {
  async function loadOrders(
    key: BranchKey,
    sessionIds: readonly string[],
  ): Promise<Map<string, SnapshotOrder[]>> {
    const bySession = new Map<string, SnapshotOrder[]>();
    if (sessionIds.length === 0) return bySession;
    const orderRows = await db
      .select({
        id: orders.id,
        sessionId: orders.sessionId,
        orderNumber: orders.orderNumber,
        status: orders.status,
      })
      .from(orders)
      .where(
        and(
          eq(orders.workspaceId, key.workspaceId),
          eq(orders.branchId, key.branchId),
          inArray(orders.sessionId, [...sessionIds]),
        ),
      )
      .orderBy(asc(orders.orderNumber));
    const orderIds = orderRows.map((o) => o.id);
    const itemRows = orderIds.length
      ? await db
          .select()
          .from(orderItems)
          .where(
            and(eq(orderItems.workspaceId, key.workspaceId), inArray(orderItems.orderId, orderIds)),
          )
      : [];
    const itemIds = itemRows.map((i) => i.id);
    const addonRows = itemIds.length
      ? await db
          .select({
            orderItemId: orderItemAddons.orderItemId,
            groupName: orderItemAddons.groupName,
            addonName: orderItemAddons.addonName,
          })
          .from(orderItemAddons)
          .where(
            and(
              eq(orderItemAddons.workspaceId, key.workspaceId),
              inArray(orderItemAddons.orderItemId, itemIds),
            ),
          )
          .orderBy(asc(orderItemAddons.groupName), asc(orderItemAddons.addonName))
      : [];
    const addonsByItem = new Map<string, { groupName: string; addonName: string }[]>();
    for (const a of addonRows) {
      const list = addonsByItem.get(a.orderItemId) ?? [];
      list.push({ groupName: a.groupName, addonName: a.addonName });
      addonsByItem.set(a.orderItemId, list);
    }
    const itemsByOrder = new Map<string, SnapshotOrder["items"]>();
    for (const i of itemRows) {
      const list = itemsByOrder.get(i.orderId) ?? [];
      list.push({
        id: i.id,
        itemName: i.itemName,
        variantName: i.variantName,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
        status: i.status,
        sortOrder: i.sortOrder,
        addons: addonsByItem.get(i.id) ?? [],
      });
      itemsByOrder.set(i.orderId, list);
    }
    for (const o of orderRows) {
      const list = bySession.get(o.sessionId) ?? [];
      list.push({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status as OrderStatus,
        items: itemsByOrder.get(o.id) ?? [],
      });
      bySession.set(o.sessionId, list);
    }
    return bySession;
  }

  async function findBillRow(
    key: BranchKey,
    where: SQL | undefined,
    lock: boolean,
  ): Promise<BillRecord | null> {
    const q = db
      .select({
        bill: bills,
        itemCount: itemCountSql,
      })
      .from(bills)
      .where(and(billScope(key), where))
      .limit(1);
    const [row] = lock ? await q.for("update", { of: bills }) : await q;
    return row ? toBillRecord({ ...row.bill, itemCount: row.itemCount }) : null;
  }

  function listQuery() {
    return db
      .select(listColumns)
      .from(bills)
      .innerJoin(diningTables, eq(diningTables.id, bills.tableId))
      .leftJoin(issuer, eq(issuer.id, bills.issuedBy));
  }

  return {
    async findBillBranchId(billId) {
      if (!UUID.test(billId)) return null;
      const [row] = await db
        .select({ branchId: bills.branchId })
        .from(bills)
        .where(eq(bills.id, billId))
        .limit(1);
      return row?.branchId ?? null;
    },

    async findPaymentBranchId(paymentId) {
      if (!UUID.test(paymentId)) return null;
      const [row] = await db
        .select({ branchId: payments.branchId })
        .from(payments)
        .where(eq(payments.id, paymentId))
        .limit(1);
      return row?.branchId ?? null;
    },

    async loadSettings(key) {
      const [row] = await db
        .select({
          taxes: branchSettings.taxes,
          pricesIncludeTax: branchSettings.pricesIncludeTax,
          serviceChargeBps: branchSettings.serviceChargeBps,
          paymentMethods: branchSettings.paymentMethods,
          requireFullPaymentToClose: branchSettings.requireFullPaymentToClose,
          autoCompleteOnPayment: branchSettings.autoCompleteOnPayment,
        })
        .from(branchSettings)
        .where(
          and(
            eq(branchSettings.branchId, key.branchId),
            eq(branchSettings.workspaceId, key.workspaceId),
          ),
        )
        .limit(1);
      if (!row) return DEFAULT_SETTINGS;
      return {
        ...row,
        paymentMethods: row.paymentMethods.filter((m): m is PaymentMethod =>
          (PAYMENT_METHODS as readonly string[]).includes(m),
        ),
      };
    },

    async findSession(key, sessionId, opts = {}) {
      if (!UUID.test(sessionId)) return null;
      const q = db
        .select()
        .from(tableSessions)
        .where(
          and(
            eq(tableSessions.id, sessionId),
            eq(tableSessions.workspaceId, key.workspaceId),
            eq(tableSessions.branchId, key.branchId),
          ),
        )
        .limit(1);
      const [row] = opts.lock ? await q.for("update") : await q;
      if (!row) return null;
      const [table] = await db
        .select({ name: diningTables.name })
        .from(diningTables)
        .where(eq(diningTables.id, row.tableId))
        .limit(1);
      return {
        id: row.id,
        tableId: row.tableId,
        tableName: table?.name ?? "Table",
        status: row.status,
        billRequestedAt: row.billRequestedAt,
        openedAt: row.openedAt,
        version: row.version,
      };
    },

    async updateSession(key, sessionId, expectedVersion, patch) {
      const rows = await db
        .update(tableSessions)
        .set({
          status: patch.status,
          ...(patch.closedAt ? { closedAt: patch.closedAt } : {}),
          ...(patch.closedBy ? { closedBy: patch.closedBy } : {}),
          version: sql`${tableSessions.version} + 1`,
        })
        .where(
          and(
            eq(tableSessions.id, sessionId),
            eq(tableSessions.workspaceId, key.workspaceId),
            eq(tableSessions.branchId, key.branchId),
            eq(tableSessions.version, expectedVersion),
          ),
        )
        .returning({ id: tableSessions.id });
      return rows.length === 1;
    },

    async listSessionOrders(key, sessionId) {
      const map = await loadOrders(key, [sessionId]);
      return map.get(sessionId) ?? [];
    },

    async completeServedOrders(key, sessionId, at, reason) {
      const done = await db
        .update(orders)
        .set({ status: "COMPLETED", completedAt: at, version: sql`${orders.version} + 1` })
        .where(
          and(
            eq(orders.workspaceId, key.workspaceId),
            eq(orders.branchId, key.branchId),
            eq(orders.sessionId, sessionId),
            eq(orders.status, "SERVED"),
          ),
        )
        .returning({ id: orders.id });
      if (done.length) {
        await db.insert(orderStatusHistory).values(
          done.map((o) => ({
            workspaceId: key.workspaceId,
            orderId: o.id,
            fromStatus: "SERVED",
            toStatus: "COMPLETED",
            actorType: "SYSTEM" as const,
            actorUserId: null,
            reason,
            createdAt: at,
          })),
        );
      }
      return done.length;
    },

    findLiveBillForSession(key, sessionId) {
      return findBillRow(key, and(eq(bills.sessionId, sessionId), ne(bills.status, "VOID")), false);
    },

    findBill(key, billId, opts = {}) {
      if (!UUID.test(billId)) return Promise.resolve(null);
      return findBillRow(key, eq(bills.id, billId), opts.lock ?? false);
    },

    async nextBillNumber(branchId) {
      const [row] = await db
        .insert(branchCounters)
        .values({ branchId, name: "bill", value: 1 })
        .onConflictDoUpdate({
          target: [branchCounters.branchId, branchCounters.name],
          set: { value: sql`${branchCounters.value} + 1` },
        })
        .returning({ value: branchCounters.value });
      return row!.value;
    },

    async insertBill(key, bill) {
      const [row] = await db
        .insert(bills)
        .values({
          workspaceId: key.workspaceId,
          restaurantId: key.restaurantId,
          branchId: key.branchId,
          tableId: bill.tableId,
          sessionId: bill.sessionId,
          billNumber: bill.billNumber,
          status: "ISSUED",
          paymentStatus: bill.grandTotal === 0 ? "PAID" : "UNPAID",
          currency: bill.currency,
          subtotal: bill.subtotal,
          discountType: bill.discount?.type ?? null,
          discountValue: bill.discount?.value ?? null,
          discountReason: bill.discount?.reason ?? null,
          discountAmount: bill.discountAmount,
          serviceChargeBps: bill.serviceChargeBps,
          serviceChargeAmount: bill.serviceChargeAmount,
          pricesIncludeTax: bill.pricesIncludeTax,
          taxBreakdown: bill.taxBreakdown,
          taxTotal: bill.taxTotal,
          grandTotal: bill.grandTotal,
          amountPaid: 0,
          amountRefunded: 0,
          balanceDue: bill.grandTotal,
          issuedBy: bill.issuedBy,
          issuedAt: bill.issuedAt,
        })
        .returning({ id: bills.id });
      const billId = row!.id;
      if (bill.lines.length) {
        await db.insert(billItems).values(
          bill.lines.map((l) => ({
            workspaceId: key.workspaceId,
            billId,
            orderId: l.orderId,
            orderItemId: l.orderItemId,
            orderNumber: l.orderNumber,
            name: l.name,
            variantName: l.variantName,
            addonsSummary: l.addonsSummary,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            lineTotal: l.lineTotal,
          })),
        );
      }
      return billId;
    },

    async updateBillBalance(key, billId, expectedVersion, patch) {
      const rows = await db
        .update(bills)
        .set({
          amountPaid: patch.amountPaid,
          amountRefunded: patch.amountRefunded,
          balanceDue: patch.balanceDue,
          paymentStatus: patch.paymentStatus,
          version: sql`${bills.version} + 1`,
        })
        .where(and(billScope(key), eq(bills.id, billId), eq(bills.version, expectedVersion)))
        .returning({ id: bills.id });
      return rows.length === 1;
    },

    async setBillStatus(key, billId, expectedVersion, patch) {
      const set =
        patch.status === "CLOSED"
          ? { status: "CLOSED", closedAt: patch.closedAt }
          : {
              status: "VOID",
              voidedAt: patch.voidedAt,
              voidedBy: patch.voidedBy,
              voidReason: patch.voidReason,
            };
      const rows = await db
        .update(bills)
        .set({ ...set, version: sql`${bills.version} + 1` })
        .where(and(billScope(key), eq(bills.id, billId), eq(bills.version, expectedVersion)))
        .returning({ id: bills.id });
      return rows.length === 1;
    },

    async getBillDto(key, billId) {
      if (!UUID.test(billId)) return null;
      const [row] = await db
        .select({ bill: bills, tableName: diningTables.name, issuedByName: issuer.name })
        .from(bills)
        .innerJoin(diningTables, eq(diningTables.id, bills.tableId))
        .leftJoin(issuer, eq(issuer.id, bills.issuedBy))
        .where(and(billScope(key), eq(bills.id, billId)))
        .limit(1);
      if (!row) return null;
      const b = row.bill;
      const itemRows = await db
        .select({
          orderNumber: billItems.orderNumber,
          name: billItems.name,
          variantName: billItems.variantName,
          addonsSummary: billItems.addonsSummary,
          quantity: billItems.quantity,
          unitPrice: billItems.unitPrice,
          lineTotal: billItems.lineTotal,
          sortOrder: orderItems.sortOrder,
        })
        .from(billItems)
        .leftJoin(orderItems, eq(orderItems.id, billItems.orderItemId))
        .where(and(eq(billItems.workspaceId, key.workspaceId), eq(billItems.billId, b.id)))
        .orderBy(
          asc(billItems.orderNumber),
          asc(sql`coalesce(${orderItems.sortOrder}, 0)`),
          asc(billItems.name),
        );
      const paymentRows = await db
        .select({ p: payments, recordedByName: recorder.name })
        .from(payments)
        .leftJoin(recorder, eq(recorder.id, payments.recordedBy))
        .where(
          and(
            eq(payments.workspaceId, key.workspaceId),
            eq(payments.branchId, key.branchId),
            eq(payments.billId, b.id),
          ),
        )
        .orderBy(asc(payments.createdAt), asc(payments.id));
      const items: BillItemDto[] = itemRows.map((i) => ({
        orderNumber: i.orderNumber,
        name: i.name,
        variantName: i.variantName,
        addonsSummary: i.addonsSummary,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
      }));
      const paymentDtos: PaymentDto[] = paymentRows.map(({ p, recordedByName }) => ({
        id: p.id,
        kind: p.kind,
        method: p.method,
        amount: p.amount,
        tendered: p.tendered,
        reference: p.reference,
        note: p.note,
        status: p.status,
        recordedByName,
        createdAt: p.createdAt.toISOString(),
        voidReason: p.voidReason,
      }));
      const dto: BillDto = {
        id: b.id,
        branchId: b.branchId,
        tableId: b.tableId,
        tableName: row.tableName,
        sessionId: b.sessionId,
        billNumber: b.billNumber,
        status: b.status as BillStatus,
        paymentStatus: b.paymentStatus as PaymentStatus,
        currency: b.currency,
        discount:
          b.discountType && b.discountValue !== null
            ? { type: b.discountType, value: b.discountValue, reason: b.discountReason }
            : null,
        subtotal: b.subtotal,
        discountAmount: b.discountAmount,
        serviceChargeBps: b.serviceChargeBps,
        serviceChargeAmount: b.serviceChargeAmount,
        taxes: b.taxBreakdown,
        taxTotal: b.taxTotal,
        grandTotal: b.grandTotal,
        pricesIncludeTax: b.pricesIncludeTax,
        amountPaid: b.amountPaid,
        amountRefunded: b.amountRefunded,
        balanceDue: b.balanceDue,
        issuedAt: b.issuedAt.toISOString(),
        issuedByName: row.issuedByName,
        closedAt: b.closedAt?.toISOString() ?? null,
        version: b.version,
        items,
        payments: paymentDtos,
      };
      return dto;
    },

    async listBills(key, filter) {
      const where = and(
        billScope(key),
        filter.paymentStatus?.length ? inArray(bills.paymentStatus, filter.paymentStatus) : undefined,
        filter.status?.length ? inArray(bills.status, filter.status) : undefined,
        filter.start ? gte(bills.issuedAt, filter.start) : undefined,
        filter.end ? lt(bills.issuedAt, filter.end) : undefined,
      );
      const rows = await listQuery()
        .where(where)
        .orderBy(desc(bills.issuedAt), desc(bills.billNumber))
        .limit(filter.pageSize)
        .offset((filter.page - 1) * filter.pageSize);
      const [count] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(bills)
        .where(where);
      return { items: rows.map(toListItem), total: Number(count?.n ?? 0) };
    },

    async listOpenBills(key) {
      const rows = await listQuery()
        .where(and(billScope(key), eq(bills.status, "ISSUED")))
        .orderBy(asc(bills.issuedAt));
      return rows.map(toListItem);
    },

    async listSessionsAwaitingBill(key) {
      const rows = await db
        .select({
          id: tableSessions.id,
          tableId: tableSessions.tableId,
          tableName: diningTables.name,
          status: tableSessions.status,
          openedAt: tableSessions.openedAt,
          billRequestedAt: tableSessions.billRequestedAt,
        })
        .from(tableSessions)
        .innerJoin(diningTables, eq(diningTables.id, tableSessions.tableId))
        .where(
          and(
            eq(tableSessions.workspaceId, key.workspaceId),
            eq(tableSessions.branchId, key.branchId),
            ne(tableSessions.status, "CLOSED"),
            sql`not exists (select 1 from ${bills} where ${bills.sessionId} = ${tableSessions.id} and ${bills.status} <> 'VOID')`,
          ),
        )
        .orderBy(asc(tableSessions.openedAt));
      const ordersBySession = await loadOrders(
        key,
        rows.map((r) => r.id),
      );
      const out: SessionAwaitingBillDto[] = [];
      for (const s of rows) {
        const sessionOrders = ordersBySession.get(s.id) ?? [];
        if (sessionOrders.length === 0 && s.status !== "BILL_REQUESTED") continue;
        const counts = countSessionOrders(sessionOrders);
        out.push({
          sessionId: s.id,
          tableId: s.tableId,
          tableName: s.tableName,
          status: s.status as SessionAwaitingBillDto["status"],
          openedAt: s.openedAt.toISOString(),
          billRequestedAt: s.billRequestedAt?.toISOString() ?? null,
          billableOrderCount: counts.billableOrderCount,
          pendingOrderCount: counts.pendingOrderCount,
          runningSubtotal: sum(buildBillLines(sessionOrders).map((l) => l.lineTotal)),
        });
      }
      // Tables that asked for the bill first, oldest request on top.
      return out.sort((a, b) => {
        if (a.billRequestedAt && b.billRequestedAt)
          return a.billRequestedAt.localeCompare(b.billRequestedAt);
        if (a.billRequestedAt) return -1;
        if (b.billRequestedAt) return 1;
        return a.openedAt.localeCompare(b.openedAt);
      });
    },

    async receiptContext(key) {
      const [row] = await db
        .select({
          branchName: branches.name,
          addressLine1: branches.addressLine1,
          addressLine2: branches.addressLine2,
          city: branches.city,
          state: branches.state,
          postalCode: branches.postalCode,
          phone: branches.phone,
          timezone: branches.timezone,
          restaurantName: restaurants.name,
          legalName: workspaces.legalName,
          taxId: workspaces.taxId,
          receiptHeader: branchSettings.receiptHeader,
          receiptFooter: branchSettings.receiptFooter,
        })
        .from(branches)
        .innerJoin(restaurants, eq(restaurants.id, branches.restaurantId))
        .innerJoin(workspaces, eq(workspaces.id, branches.workspaceId))
        .leftJoin(branchSettings, eq(branchSettings.branchId, branches.id))
        .where(and(eq(branches.id, key.branchId), eq(branches.workspaceId, key.workspaceId)))
        .limit(1);
      if (!row) {
        return {
          restaurantName: "",
          branchName: "",
          legalName: null,
          taxId: null,
          addressLines: [],
          phone: null,
          timezone: "UTC",
          receiptHeader: null,
          receiptFooter: null,
        };
      }
      const cityLine = [row.city, row.state, row.postalCode].filter(Boolean).join(", ");
      return {
        restaurantName: row.restaurantName,
        branchName: row.branchName,
        legalName: row.legalName,
        taxId: row.taxId,
        addressLines: [row.addressLine1, row.addressLine2, cityLine].filter(
          (l): l is string => Boolean(l && l.trim()),
        ),
        phone: row.phone,
        timezone: row.timezone,
        receiptHeader: row.receiptHeader,
        receiptFooter: row.receiptFooter,
      };
    },

    async listLedger(billId) {
      const rows = await db
        .select()
        .from(payments)
        .where(eq(payments.billId, billId))
        .orderBy(asc(payments.createdAt), asc(payments.id));
      return rows.map(toPaymentRecord);
    },

    async findPaymentByIdempotencyKey(branchId, idempotencyKey) {
      const [row] = await db
        .select()
        .from(payments)
        .where(and(eq(payments.branchId, branchId), eq(payments.idempotencyKey, idempotencyKey)))
        .limit(1);
      return row ? toPaymentRecord(row) : null;
    },

    async findPayment(key, paymentId) {
      if (!UUID.test(paymentId)) return null;
      const [row] = await db
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.id, paymentId),
            eq(payments.workspaceId, key.workspaceId),
            eq(payments.branchId, key.branchId),
          ),
        )
        .limit(1);
      return row ? toPaymentRecord(row) : null;
    },

    async insertPayment(key, p) {
      const [row] = await db
        .insert(payments)
        .values({
          workspaceId: key.workspaceId,
          branchId: key.branchId,
          billId: p.billId,
          kind: p.kind,
          method: p.method,
          amount: p.amount,
          tendered: p.tendered,
          reference: p.reference,
          note: p.note,
          status: "CONFIRMED",
          idempotencyKey: p.idempotencyKey,
          recordedBy: p.recordedBy,
          // Wall-clock time (not transaction start) keeps the ledger ordered.
          createdAt: sql`clock_timestamp()`,
        })
        .returning({ id: payments.id });
      return row!.id;
    },

    async voidPayment(key, paymentId, patch) {
      const rows = await db
        .update(payments)
        .set({
          status: "VOIDED",
          voidedAt: patch.voidedAt,
          voidedBy: patch.voidedBy,
          voidReason: patch.voidReason,
        })
        .where(
          and(
            eq(payments.id, paymentId),
            eq(payments.workspaceId, key.workspaceId),
            eq(payments.branchId, key.branchId),
            eq(payments.status, "CONFIRMED"),
          ),
        )
        .returning({ id: payments.id });
      return rows.length === 1;
    },

    async insertHistory(key, entry) {
      await db.insert(paymentHistory).values({
        workspaceId: key.workspaceId,
        billId: entry.billId,
        paymentId: entry.paymentId ?? null,
        action: entry.action,
        amount: entry.amount ?? null,
        balanceBefore: entry.balanceBefore ?? null,
        balanceAfter: entry.balanceAfter ?? null,
        paymentStatusAfter: entry.paymentStatusAfter ?? null,
        actorUserId: entry.actorUserId,
        createdAt: sql`clock_timestamp()`,
      });
    },

    async paymentSummary(key, range) {
      const methodRows = await db
        .select({
          method: payments.method,
          kind: payments.kind,
          total: sql<number>`coalesce(sum(${payments.amount}), 0)`.mapWith(Number),
        })
        .from(payments)
        .where(
          and(
            eq(payments.workspaceId, key.workspaceId),
            eq(payments.branchId, key.branchId),
            eq(payments.status, "CONFIRMED"),
            gte(payments.createdAt, range.start),
            lt(payments.createdAt, range.end),
          ),
        )
        .groupBy(payments.method, payments.kind);
      const [open] = await db
        .select({
          outstanding: sql<number>`coalesce(sum(${bills.balanceDue}), 0)`.mapWith(Number),
          partiallyPaid:
            sql<number>`count(*) filter (where ${bills.paymentStatus} = 'PARTIALLY_PAID')`.mapWith(
              Number,
            ),
        })
        .from(bills)
        .where(and(billScope(key), eq(bills.status, "ISSUED")));
      const [issued] = await db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(bills)
        .where(
          and(
            billScope(key),
            ne(bills.status, "VOID"),
            gte(bills.issuedAt, range.start),
            lt(bills.issuedAt, range.end),
          ),
        );
      return {
        byMethod: methodRows.map((r) => ({
          method: r.method,
          kind: r.kind as PaymentKind,
          total: r.total,
        })),
        outstanding: open?.outstanding ?? 0,
        partiallyPaidBills: open?.partiallyPaid ?? 0,
        billsIssued: issued?.n ?? 0,
      };
    },
  };
}
