/**
 * Direct-insert fixtures for billing tests: tables, sessions and orders with
 * order-time snapshots, bypassing the ordering/staff-ops APIs.
 */
import { eq } from "drizzle-orm";

import type { OrderStatus } from "@/domain/orders/order-status";
import {
  branchSettings,
  diningTables,
  menuItems,
  orderItemAddons,
  orderItems,
  orders,
  tableSessions,
} from "@/infrastructure/database/providers/postgres/schema";
import type { Container } from "@/server/container";

import { POST as signUp } from "@/app/api/v1/auth/signup/route";

import {
  addStaffMember,
  createSiblingWorkspaceAs,
  createWorkspaceAs,
  insertRestaurantWithBranch,
  type TestUser,
} from "./fixtures";
import { call, cookieFrom, uniqueEmail } from "./harness";

export interface BillingBranch {
  owner: TestUser;
  workspaceId: string;
  restaurantId: string;
  branchId: string;
  categoryId: string;
}

let seq = 0;
let ipCounter = 0;

/** Sign up through the real endpoint, each user from its own client IP (per-IP signup limit). */
export async function signUpBillingUser(name = "Billing User"): Promise<TestUser> {
  ipCounter += 1;
  const email = uniqueEmail("billing");
  const password = "correct-horse-42";
  const res = await call<{ user: { id: string } }>(signUp, {
    body: { name, email, password, acceptTerms: true },
    headers: { "x-forwarded-for": `10.88.${Math.floor(ipCounter / 250)}.${ipCounter % 250}` },
  });
  if (res.status !== 201)
    throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { userId: res.body.data!.user.id, email, password, cookie: cookieFrom(res.setCookie) };
}

export async function setupBillingBranch(
  c: Container,
  opts: {
    taxes?: { name: string; rateBps: number }[];
    settings?: Partial<typeof branchSettings.$inferInsert>;
    owner?: TestUser;
  } = {},
): Promise<BillingBranch> {
  const owner = opts.owner ?? (await signUpBillingUser("Owner"));
  // An existing owner gets a second workspace in their organization (a trial holds one).
  const ws = opts.owner
    ? await createSiblingWorkspaceAs(c, owner, `Billing WS ${++seq}`)
    : await createWorkspaceAs(owner, `Billing WS ${++seq}`);
  const r = await insertRestaurantWithBranch(c, ws.id, { taxes: opts.taxes });
  if (opts.settings) {
    await c.db
      .update(branchSettings)
      .set(opts.settings)
      .where(eq(branchSettings.branchId, r.branchId));
  }
  return {
    owner,
    workspaceId: ws.id,
    restaurantId: r.restaurantId,
    branchId: r.branchId,
    categoryId: r.categoryId,
  };
}

export async function addBranchStaff(
  c: Container,
  b: BillingBranch,
  role: "waiter" | "kitchen_staff" | "cashier" | "restaurant_manager",
): Promise<TestUser> {
  const user = await signUpBillingUser(role);
  await addStaffMember(c, {
    workspaceId: b.workspaceId,
    userId: user.userId,
    role,
    restaurantId: b.restaurantId,
    branchId: role === "restaurant_manager" ? undefined : b.branchId,
  });
  return user;
}

export async function insertMenuItem(
  c: Container,
  b: BillingBranch,
  name: string,
  price: number,
): Promise<string> {
  const [row] = await c.db
    .insert(menuItems)
    .values({
      workspaceId: b.workspaceId,
      restaurantId: b.restaurantId,
      categoryId: b.categoryId,
      name,
      price,
    })
    .returning({ id: menuItems.id });
  return row!.id;
}

export async function openSession(
  c: Container,
  b: BillingBranch,
  tableName = `T${++seq}`,
  status: "OPEN" | "BILL_REQUESTED" = "OPEN",
): Promise<{ tableId: string; sessionId: string }> {
  const [t] = await c.db
    .insert(diningTables)
    .values({
      workspaceId: b.workspaceId,
      restaurantId: b.restaurantId,
      branchId: b.branchId,
      name: tableName,
    })
    .returning({ id: diningTables.id });
  const [s] = await c.db
    .insert(tableSessions)
    .values({
      workspaceId: b.workspaceId,
      restaurantId: b.restaurantId,
      branchId: b.branchId,
      tableId: t!.id,
      status,
      billRequestedAt: status === "BILL_REQUESTED" ? new Date() : null,
    })
    .returning({ id: tableSessions.id });
  return { tableId: t!.id, sessionId: s!.id };
}

export interface FixtureLine {
  name: string;
  unitPrice: number;
  quantity?: number;
  variantName?: string | null;
  menuItemId?: string | null;
  status?: "PENDING" | "PREPARING" | "READY" | "SERVED" | "CANCELLED";
  addons?: { groupName: string; addonName: string; price: number }[];
}

let orderSeq = 1000;

export async function insertOrder(
  c: Container,
  b: BillingBranch,
  session: { tableId: string; sessionId: string },
  status: OrderStatus,
  lines: FixtureLine[],
): Promise<{ orderId: string; itemIds: string[] }> {
  const computed = lines.map((l) => {
    const addonTotal = (l.addons ?? []).reduce((a, x) => a + x.price, 0);
    const unit = l.unitPrice + addonTotal;
    const qty = l.quantity ?? 1;
    return { ...l, addonTotal, unit, qty, lineTotal: unit * qty };
  });
  const [o] = await c.db
    .insert(orders)
    .values({
      workspaceId: b.workspaceId,
      restaurantId: b.restaurantId,
      branchId: b.branchId,
      tableId: session.tableId,
      sessionId: session.sessionId,
      source: "STAFF",
      orderNumber: ++orderSeq,
      status,
      currency: "INR",
      subtotal: computed.reduce((a, l) => a + l.lineTotal, 0),
      itemCount: computed.reduce((a, l) => a + l.qty, 0),
      idempotencyKey: `fixture-${orderSeq}-${Math.random().toString(36).slice(2, 10)}`,
    })
    .returning({ id: orders.id });
  const itemIds: string[] = [];
  for (const [i, l] of computed.entries()) {
    const [item] = await c.db
      .insert(orderItems)
      .values({
        workspaceId: b.workspaceId,
        orderId: o!.id,
        menuItemId: l.menuItemId ?? null,
        itemName: l.name,
        variantName: l.variantName ?? null,
        baseUnitPrice: l.unitPrice,
        addonsUnitTotal: l.addonTotal,
        unitPrice: l.unit,
        quantity: l.qty,
        lineTotal: l.lineTotal,
        status: l.status ?? "SERVED",
        sortOrder: i,
      })
      .returning({ id: orderItems.id });
    itemIds.push(item!.id);
    if (l.addons?.length) {
      await c.db.insert(orderItemAddons).values(
        l.addons.map((a) => ({
          workspaceId: b.workspaceId,
          orderItemId: item!.id,
          groupName: a.groupName,
          addonName: a.addonName,
          price: a.price,
        })),
      );
    }
  }
  return { orderId: o!.id, itemIds };
}
