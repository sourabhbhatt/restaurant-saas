/**
 * Direct-insert fixtures for analytics tests: tables, sessions, orders (with
 * snapshot lines), bills and payments with explicit timestamps, bypassing the
 * APIs owned by other modules.
 */
import {
  bills,
  branchSettings,
  branches,
  diningTables,
  orderItems,
  orders,
  payments,
  tableSessions,
} from "@ros/database/providers/postgres/schema";
import type { Container } from "@/composition/container";

let seq = 0;
const next = () => ++seq;

export interface BranchRefs {
  workspaceId: string;
  restaurantId: string;
  branchId: string;
}

export async function insertBranch(
  c: Container,
  input: { workspaceId: string; restaurantId: string; name: string; timezone?: string },
): Promise<string> {
  const [b] = await c.db
    .insert(branches)
    .values({
      workspaceId: input.workspaceId,
      restaurantId: input.restaurantId,
      name: input.name,
      code: `x${next()}${Date.now().toString(36)}`,
      timezone: input.timezone ?? "Asia/Kolkata",
    })
    .returning({ id: branches.id });
  await c.db.insert(branchSettings).values({ branchId: b!.id, workspaceId: input.workspaceId });
  return b!.id;
}

export async function insertTable(c: Container, ref: BranchRefs, name: string): Promise<string> {
  const [t] = await c.db
    .insert(diningTables)
    .values({ ...ref, name })
    .returning({ id: diningTables.id });
  return t!.id;
}

export async function insertSession(
  c: Container,
  ref: BranchRefs,
  input: { tableId: string; openedAt: string; closedAt?: string | null },
): Promise<string> {
  const [s] = await c.db
    .insert(tableSessions)
    .values({
      ...ref,
      tableId: input.tableId,
      status: input.closedAt ? "CLOSED" : "OPEN",
      openedAt: new Date(input.openedAt),
      closedAt: input.closedAt ? new Date(input.closedAt) : null,
    })
    .returning({ id: tableSessions.id });
  return s!.id;
}

export interface OrderLine {
  name: string;
  category?: string | null;
  quantity: number;
  unitPrice: number;
}

export async function insertOrder(
  c: Container,
  ref: BranchRefs,
  input: {
    tableId: string;
    sessionId: string;
    status: string;
    createdAt: string;
    /** Minutes after createdAt. */
    acceptedAfter?: number;
    /** Minutes after acceptance. */
    readyAfter?: number;
    lines: OrderLine[];
  },
): Promise<string> {
  const created = new Date(input.createdAt);
  const accepted =
    input.acceptedAfter !== undefined
      ? new Date(created.getTime() + input.acceptedAfter * 60_000)
      : null;
  const ready =
    accepted && input.readyAfter !== undefined
      ? new Date(accepted.getTime() + input.readyAfter * 60_000)
      : null;
  const subtotal = input.lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const n = next();
  const [o] = await c.db
    .insert(orders)
    .values({
      ...ref,
      tableId: input.tableId,
      sessionId: input.sessionId,
      source: "STAFF",
      orderNumber: n,
      status: input.status,
      currency: "INR",
      subtotal,
      itemCount: input.lines.reduce((s, l) => s + l.quantity, 0),
      idempotencyKey: `seed-${n}`,
      acceptedAt: accepted,
      readyAt: ready,
      createdAt: created,
    })
    .returning({ id: orders.id });
  await c.db.insert(orderItems).values(
    input.lines.map((l, i) => ({
      workspaceId: ref.workspaceId,
      orderId: o!.id,
      categoryName: l.category ?? null,
      itemName: l.name,
      baseUnitPrice: l.unitPrice,
      unitPrice: l.unitPrice,
      quantity: l.quantity,
      lineTotal: l.quantity * l.unitPrice,
      sortOrder: i,
    })),
  );
  return o!.id;
}

export async function insertBill(
  c: Container,
  ref: BranchRefs,
  input: {
    tableId: string;
    sessionId: string;
    grandTotal: number;
    amountPaid: number;
    issuedAt: string;
    status?: "ISSUED" | "CLOSED" | "VOID";
    discount?: number;
  },
): Promise<string> {
  const balance = input.grandTotal - input.amountPaid;
  const paymentStatus =
    input.amountPaid === 0 ? "UNPAID" : balance === 0 ? "PAID" : "PARTIALLY_PAID";
  const [b] = await c.db
    .insert(bills)
    .values({
      ...ref,
      tableId: input.tableId,
      sessionId: input.sessionId,
      billNumber: next(),
      status: input.status ?? (balance === 0 ? "CLOSED" : "ISSUED"),
      paymentStatus,
      currency: "INR",
      subtotal: input.grandTotal,
      discountAmount: input.discount ?? 0,
      pricesIncludeTax: true,
      taxBreakdown: [],
      taxTotal: 0,
      grandTotal: input.grandTotal,
      amountPaid: input.amountPaid,
      balanceDue: balance,
      issuedAt: new Date(input.issuedAt),
    })
    .returning({ id: bills.id });
  return b!.id;
}

export async function insertPayment(
  c: Container,
  ref: BranchRefs,
  input: {
    billId: string;
    method: "CASH" | "UPI" | "CARD" | "OTHER";
    amount: number;
    createdAt: string;
    kind?: "PAYMENT" | "REFUND";
    status?: "CONFIRMED" | "VOIDED";
  },
): Promise<void> {
  await c.db.insert(payments).values({
    workspaceId: ref.workspaceId,
    branchId: ref.branchId,
    billId: input.billId,
    kind: input.kind ?? "PAYMENT",
    method: input.method,
    amount: input.amount,
    status: input.status ?? "CONFIRMED",
    idempotencyKey: `pay-${next()}`,
    createdAt: new Date(input.createdAt),
  });
}
