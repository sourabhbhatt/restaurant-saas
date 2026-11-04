/**
 * Direct-insert fixtures for staff-ops tests: tables, sessions, menu items and
 * orders are written straight to the database so these tests do not depend on
 * the ordering / menu / billing modules.
 */
import { sql } from "drizzle-orm";

import type { RoleTemplateKey } from "@/domain/access/permissions";
import {
  bills,
  branchSettings,
  branches,
  diningTables,
  menuItems,
  orderItemAddons,
  orderItems,
  orderStatusHistory,
  orders,
  tableSessions,
} from "@/infrastructure/database/providers/postgres/schema";
import type { Container } from "@/server/container";

import {
  addStaffMember,
  createWorkspaceAs,
  insertRestaurantWithBranch,
  signUpUser,
  type TestUser,
} from "./fixtures";

export interface TestBranch {
  workspaceId: string;
  restaurantId: string;
  branchId: string;
  categoryId: string;
  owner: TestUser;
}

export async function setupBranch(
  c: Container,
  opts: { workspaceName?: string; branchName?: string } = {},
): Promise<TestBranch> {
  const owner = await signUpUser("Owner");
  const ws = await createWorkspaceAs(owner, opts.workspaceName ?? "Staff Ops WS");
  const r = await insertRestaurantWithBranch(c, ws.id, { branchName: opts.branchName });
  return {
    workspaceId: ws.id,
    restaurantId: r.restaurantId,
    branchId: r.branchId,
    categoryId: r.categoryId,
    owner,
  };
}

/** Insert an extra branch in an existing restaurant (same workspace). */
export async function insertSiblingBranch(
  c: Container,
  base: TestBranch,
  name = "Second Branch",
): Promise<TestBranch> {
  const [b] = await c.db
    .insert(branches)
    .values({
      workspaceId: base.workspaceId,
      restaurantId: base.restaurantId,
      name,
      code: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    })
    .returning({ id: branches.id });
  await c.db.insert(branchSettings).values({ branchId: b!.id, workspaceId: base.workspaceId });
  return { ...base, branchId: b!.id };
}

export async function addStaff(
  c: Container,
  branch: TestBranch,
  role: RoleTemplateKey,
  name: string = role,
): Promise<TestUser> {
  const user = await signUpUser(name);
  await addStaffMember(c, {
    workspaceId: branch.workspaceId,
    userId: user.userId,
    role,
    restaurantId: branch.restaurantId,
    branchId: role.startsWith("workspace_") ? undefined : branch.branchId,
  });
  return user;
}

export async function insertTable(
  c: Container,
  branch: TestBranch,
  name: string,
  opts: { isActive?: boolean } = {},
): Promise<string> {
  const [t] = await c.db
    .insert(diningTables)
    .values({
      workspaceId: branch.workspaceId,
      restaurantId: branch.restaurantId,
      branchId: branch.branchId,
      name,
      isActive: opts.isActive ?? true,
    })
    .returning({ id: diningTables.id });
  return t!.id;
}

export async function openSession(
  c: Container,
  branch: TestBranch,
  tableId: string,
  status: "OPEN" | "BILL_REQUESTED" | "BILLED" = "OPEN",
): Promise<string> {
  const [s] = await c.db
    .insert(tableSessions)
    .values({
      workspaceId: branch.workspaceId,
      restaurantId: branch.restaurantId,
      branchId: branch.branchId,
      tableId,
      status,
      billRequestedAt: status === "BILL_REQUESTED" ? new Date() : null,
    })
    .returning({ id: tableSessions.id });
  return s!.id;
}

export async function insertMenuItem(
  c: Container,
  branch: TestBranch,
  name: string,
  opts: { price?: number; prepTimeMinutes?: number } = {},
): Promise<string> {
  const [m] = await c.db
    .insert(menuItems)
    .values({
      workspaceId: branch.workspaceId,
      restaurantId: branch.restaurantId,
      categoryId: branch.categoryId,
      name,
      price: opts.price ?? 25_000,
      prepTimeMinutes: opts.prepTimeMinutes ?? 15,
    })
    .returning({ id: menuItems.id });
  return m!.id;
}

export interface InsertOrderInput {
  tableId: string;
  sessionId: string;
  lines: { menuItemId?: string | null; name: string; quantity?: number; unitPrice?: number }[];
  status?: string;
  specialInstructions?: string;
  acceptedAt?: Date;
}

export async function insertOrder(
  c: Container,
  branch: TestBranch,
  input: InsertOrderInput,
): Promise<{ orderId: string; orderNumber: number; itemIds: string[] }> {
  const [{ next } = { next: 1 }] = await c.db
    .select({ next: sql<number>`coalesce(max(${orders.orderNumber}), 0)::int + 1` })
    .from(orders)
    .where(sql`${orders.branchId} = ${branch.branchId}`);
  const lines = input.lines.map((l) => ({
    ...l,
    quantity: l.quantity ?? 1,
    unitPrice: l.unitPrice ?? 25_000,
  }));
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const [o] = await c.db
    .insert(orders)
    .values({
      workspaceId: branch.workspaceId,
      restaurantId: branch.restaurantId,
      branchId: branch.branchId,
      tableId: input.tableId,
      sessionId: input.sessionId,
      source: "CUSTOMER",
      orderNumber: next,
      status: input.status ?? "PENDING",
      specialInstructions: input.specialInstructions ?? null,
      currency: "INR",
      subtotal,
      itemCount: lines.reduce((s, l) => s + l.quantity, 0),
      idempotencyKey: `test-${crypto.randomUUID()}`,
      acceptedAt: input.acceptedAt ?? null,
    })
    .returning({ id: orders.id, orderNumber: orders.orderNumber });
  const itemIds: string[] = [];
  for (const [i, l] of lines.entries()) {
    const [it] = await c.db
      .insert(orderItems)
      .values({
        workspaceId: branch.workspaceId,
        orderId: o!.id,
        menuItemId: l.menuItemId ?? null,
        itemName: l.name,
        baseUnitPrice: l.unitPrice,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        lineTotal: l.quantity * l.unitPrice,
        sortOrder: i,
      })
      .returning({ id: orderItems.id });
    itemIds.push(it!.id);
  }
  if (itemIds[0]) {
    await c.db.insert(orderItemAddons).values({
      workspaceId: branch.workspaceId,
      orderItemId: itemIds[0],
      groupName: "Spice",
      addonName: "Extra hot",
      price: 0,
    });
  }
  await c.db.insert(orderStatusHistory).values({
    workspaceId: branch.workspaceId,
    orderId: o!.id,
    fromStatus: null,
    toStatus: "PENDING",
    actorType: "GUEST",
  });
  return { orderId: o!.id, orderNumber: o!.orderNumber, itemIds };
}

export async function insertBill(
  c: Container,
  branch: TestBranch,
  input: {
    tableId: string;
    sessionId: string;
    grandTotal: number;
    paymentStatus?: "UNPAID" | "PARTIALLY_PAID" | "PAID";
    balanceDue?: number;
  },
): Promise<string> {
  const [{ next } = { next: 1 }] = await c.db
    .select({ next: sql<number>`coalesce(max(${bills.billNumber}), 0)::int + 1` })
    .from(bills)
    .where(sql`${bills.branchId} = ${branch.branchId}`);
  const [b] = await c.db
    .insert(bills)
    .values({
      workspaceId: branch.workspaceId,
      restaurantId: branch.restaurantId,
      branchId: branch.branchId,
      tableId: input.tableId,
      sessionId: input.sessionId,
      billNumber: next,
      paymentStatus: input.paymentStatus ?? "UNPAID",
      currency: "INR",
      subtotal: input.grandTotal,
      pricesIncludeTax: false,
      taxBreakdown: [],
      taxTotal: 0,
      grandTotal: input.grandTotal,
      balanceDue: input.balanceDue ?? input.grandTotal,
    })
    .returning({ id: bills.id });
  return b!.id;
}
