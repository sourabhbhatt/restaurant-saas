import { eq } from "drizzle-orm";

import {
  auditLogs,
  billItems,
  bills,
  invitations,
  menuItemBranchOverrides,
  notifications,
  orderItemAddons,
  orderItems,
  orderStatusHistory,
  orders,
  paymentHistory,
  payments,
  roles,
  storedFiles,
  subscriptionEvents,
  subscriptionPlans,
  subscriptions,
  supportRequests,
  tableSessionMembers,
  tableSessions,
  upgradeRequests,
  workspaceEntitlements,
} from "@/infrastructure/database/providers/postgres/schema";
import type { Container } from "@/server/container";

import { addStaffMember, signUpUser, type TestUser } from "./fixtures";
import { createOrderingWorld, type OrderingWorld } from "./fixtures-ordering";

export interface TenantWorld extends OrderingWorld {
  staff: TestUser;
  customRoleId: string;
}

let seq = 0;

/**
 * A workspace with at least one row in every tenant table (row-level security
 * tests). Built on the ordering world, then direct inserts for the rest.
 */
export async function createTenantWorld(c: Container, name: string): Promise<TenantWorld> {
  const w = await createOrderingWorld(c, name);
  const ws = w.workspaceId;
  const n = ++seq;
  const staff = await signUpUser(`${name} Staff`);
  await addStaffMember(c, {
    workspaceId: ws,
    userId: staff.userId,
    role: "waiter",
    restaurantId: w.restaurantId,
    branchId: w.branchId,
  });
  const [role] = await c.db
    .insert(roles)
    .values({ workspaceId: ws, key: `custom_${n}`, name: `Custom ${n}`, scope: "BRANCH" })
    .returning({ id: roles.id });

  const [session] = await c.db
    .insert(tableSessions)
    .values({
      workspaceId: ws,
      restaurantId: w.restaurantId,
      branchId: w.branchId,
      tableId: w.table.tableId,
    })
    .returning({ id: tableSessions.id });
  await c.db
    .insert(tableSessionMembers)
    .values({ workspaceId: ws, sessionId: session!.id, guestTokenHash: `guest-${name}-${n}` });
  const [order] = await c.db
    .insert(orders)
    .values({
      workspaceId: ws,
      restaurantId: w.restaurantId,
      branchId: w.branchId,
      tableId: w.table.tableId,
      sessionId: session!.id,
      source: "STAFF",
      orderNumber: 9000 + n,
      status: "SERVED",
      currency: "INR",
      subtotal: 25_000,
      itemCount: 1,
      idempotencyKey: `rls-${name}-${n}`,
    })
    .returning({ id: orders.id });
  const [item] = await c.db
    .insert(orderItems)
    .values({
      workspaceId: ws,
      orderId: order!.id,
      menuItemId: w.simpleItemId,
      itemName: "Paneer Tikka",
      baseUnitPrice: 25_000,
      addonsUnitTotal: 0,
      unitPrice: 25_000,
      quantity: 1,
      lineTotal: 25_000,
      status: "SERVED",
      sortOrder: 0,
    })
    .returning({ id: orderItems.id });
  await c.db
    .insert(orderItemAddons)
    .values({ workspaceId: ws, orderItemId: item!.id, groupName: "G", addonName: "A", price: 0 });
  await c.db
    .insert(orderStatusHistory)
    .values({ workspaceId: ws, orderId: order!.id, toStatus: "SERVED", actorType: "SYSTEM" });

  const [bill] = await c.db
    .insert(bills)
    .values({
      workspaceId: ws,
      restaurantId: w.restaurantId,
      branchId: w.branchId,
      tableId: w.table.tableId,
      sessionId: session!.id,
      billNumber: n,
      currency: "INR",
      subtotal: 25_000,
      pricesIncludeTax: false,
      taxBreakdown: [],
      taxTotal: 0,
      grandTotal: 25_000,
      balanceDue: 0,
    })
    .returning({ id: bills.id });
  await c.db.insert(billItems).values({
    workspaceId: ws,
    billId: bill!.id,
    name: "Paneer Tikka",
    quantity: 1,
    unitPrice: 25_000,
    lineTotal: 25_000,
  });
  const [payment] = await c.db
    .insert(payments)
    .values({
      workspaceId: ws,
      branchId: w.branchId,
      billId: bill!.id,
      method: "CASH",
      amount: 25_000,
      idempotencyKey: `rls-pay-${name}-${n}`,
    })
    .returning({ id: payments.id });
  await c.db
    .insert(paymentHistory)
    .values({ workspaceId: ws, billId: bill!.id, paymentId: payment!.id, action: "RECORDED" });

  await c.db.insert(menuItemBranchOverrides).values({
    workspaceId: ws,
    branchId: w.branchId,
    itemId: w.simpleItemId,
    isAvailable: false,
  });
  const [ownerRole] = await c.db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.key, "workspace_member"))
    .limit(1);
  await c.db.insert(invitations).values({
    workspaceId: ws,
    email: `invitee.${n}@example.test`,
    tokenHash: `rls-invite-${name}-${n}`,
    workspaceRoleId: ownerRole!.id,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  await c.db
    .insert(notifications)
    .values({ userId: staff.userId, workspaceId: ws, type: "test", title: `Hello ${name}` });
  await c.db.insert(storedFiles).values({
    workspaceId: ws,
    key: `ws/${ws}/menu_item/rls-${n}.png`,
    contentType: "image/png",
    sizeBytes: 10,
    purpose: "menu_item",
  });
  const [sub] = await c.db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, ws))
    .limit(1);
  await c.db
    .insert(subscriptionEvents)
    .values({ workspaceId: ws, subscriptionId: sub?.id ?? null, type: "TEST" });
  await c.db.insert(supportRequests).values({
    workspaceId: ws,
    contactEmail: w.owner.email,
    subject: `Help ${name}`,
    message: "Test",
  });
  const [plan] = await c.db.select({ id: subscriptionPlans.id }).from(subscriptionPlans).limit(1);
  await c.db.insert(upgradeRequests).values({ workspaceId: ws, requestedPlanId: plan!.id });
  await c.db.insert(workspaceEntitlements).values({ workspaceId: ws, key: "storageMb", value: 50 });
  await c.db.insert(auditLogs).values({ workspaceId: ws, actorType: "SYSTEM", action: "rls.test" });
  return { ...w, staff, customRoleId: role!.id };
}
