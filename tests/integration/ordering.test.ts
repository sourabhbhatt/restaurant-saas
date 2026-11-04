import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { POST as staffOrder } from "@/app/api/v1/branches/[branchId]/orders/route";
import { GET as resolveQr } from "@/app/api/v1/public/qr/[token]/route";
import { POST as joinSession } from "@/app/api/v1/public/qr/[token]/session/route";
import { POST as billRequest } from "@/app/api/v1/public/session/bill-request/route";
import { POST as placeOrder } from "@/app/api/v1/public/session/orders/route";
import { GET as getSession } from "@/app/api/v1/public/session/route";
import type { BillRequestResultDto, GuestSessionDto, JoinSessionDto, PublicQrDto } from "@/contracts/ordering";
import type { GuestOrderDto, OrderDto } from "@/contracts/orders";
import {
  auditLogs,
  billItems,
  bills,
  branchSettings,
  diningTables,
  notifications,
  orderItemAddons,
  orderItems,
  orderStatusHistory,
  orders,
  rateLimitBuckets,
  tableQrTokens,
  tableSessions,
  workspaceEntitlements,
  workspaces,
} from "@/infrastructure/database/providers/postgres/schema";
import type { Container } from "@/server/container";
import { generateToken } from "@/domain/shared/tokens";
import { addStaffMember, insertRestaurantWithBranch, signUpUser } from "@/test/fixtures";
import {
  createOrderingWorld,
  insertTableWithQr,
  type OrderingWorld,
} from "@/test/fixtures-ordering";
import { call, cookieFrom, createTestContainer } from "@/test/harness";

let c: Container;
beforeAll(async () => {
  c = await createTestContainer();
});
afterAll(async () => {
  await c.close();
});
// Fixtures sign up many users from one test "IP"; keep the signup limiter out of the way.
beforeEach(async () => {
  await c.db.delete(rateLimitBuckets);
});

let keyCounter = 0;
const key = () => `test-key-${Date.now().toString(36)}-${++keyCounter}`;

async function join(token: string, cookie?: string) {
  return call<JoinSessionDto>(joinSession, {
    method: "POST",
    params: { token },
    cookie: cookie ?? null,
    headers: { "x-forwarded-for": `10.0.${keyCounter % 250}.${++keyCounter % 250}` },
  });
}

async function guest(token: string): Promise<{ cookie: string; sessionId: string }> {
  const res = await join(token);
  expect(res.status).toBe(201);
  return { cookie: cookieFrom(res.setCookie), sessionId: res.body.data!.sessionId };
}

function order(cookie: string, body: Record<string, unknown>) {
  return call<GuestOrderDto & { timeline: { status: string }[] }>(placeOrder, {
    body: { idempotencyKey: key(), ...body },
    cookie,
  });
}

const session = (cookie: string) => call<GuestSessionDto>(getSession, { cookie });

describe("QR resolution", () => {
  let w: OrderingWorld;
  beforeAll(async () => {
    w = await createOrderingWorld(c, "QR Owner");
  });

  it("returns branding, table and the available menu for an active QR", async () => {
    const res = await call<PublicQrDto>(resolveQr, { params: { token: w.table.token } });
    expect(res.status).toBe(200);
    const d = res.body.data!;
    expect(d.branding.restaurantName).toBe("Spice Garden");
    expect(d.branch.name).toBe("Main Branch");
    expect(d.table.name).toMatch(/^T/);
    expect(d.currency).toBe("INR");
    expect(d.hasOpenSession).toBe(false);
    const names = d.menu.categories.flatMap((cat) => cat.items.map((i) => i.name));
    expect(names).toEqual(expect.arrayContaining(["Paneer Tikka", "Margherita Pizza"]));
    expect(names).not.toContain("Seasonal Special");
    // No internal ids of the tenant leak beyond menu ids.
    expect(JSON.stringify(d)).not.toContain(w.workspaceId);
    expect(JSON.stringify(d)).not.toContain(w.table.tableId);
  });

  it("treats unknown, malformed, revoked and inactive-table QRs identically", async () => {
    const unknown = await call(resolveQr, { params: { token: generateToken() } });
    const malformed = await call(resolveQr, { params: { token: "not-a-token" } });

    const revoked = await insertTableWithQr(c, {
      workspaceId: w.workspaceId,
      restaurantId: w.restaurantId,
      branchId: w.branchId,
    });
    await c.db
      .update(tableQrTokens)
      .set({ status: "REVOKED", revokedAt: new Date() })
      .where(eq(tableQrTokens.tableId, revoked.tableId));
    const revokedRes = await call(resolveQr, { params: { token: revoked.token } });

    const inactive = await insertTableWithQr(c, {
      workspaceId: w.workspaceId,
      restaurantId: w.restaurantId,
      branchId: w.branchId,
    });
    await c.db
      .update(diningTables)
      .set({ isActive: false })
      .where(eq(diningTables.id, inactive.tableId));
    const inactiveRes = await call(resolveQr, { params: { token: inactive.token } });
    const inactiveJoin = await join(inactive.token);

    for (const res of [unknown, malformed, revokedRes, inactiveRes, inactiveJoin]) {
      expect(res.status).toBe(404);
      expect(res.body.error!.code).toBe("QR_INVALID");
      expect(res.body.error!.message).toBe(unknown.body.error!.message);
    }
  });

  it("rejects QRs of a suspended workspace or one without the qr_ordering feature", async () => {
    const s = await createOrderingWorld(c, "Suspended Owner");
    expect((await call(resolveQr, { params: { token: s.table.token } })).status).toBe(200);
    await c.db.update(workspaces).set({ status: "SUSPENDED" }).where(eq(workspaces.id, s.workspaceId));
    const res = await call(resolveQr, { params: { token: s.table.token } });
    expect(res.status).toBe(404);
    expect(res.body.error!.code).toBe("QR_INVALID");

    const f = await createOrderingWorld(c, "No Feature Owner");
    await c.db
      .insert(workspaceEntitlements)
      .values({ workspaceId: f.workspaceId, key: "feature:qr_ordering", value: false });
    expect((await call(resolveQr, { params: { token: f.table.token } })).body.error!.code).toBe(
      "QR_INVALID",
    );
  });

  it("is invalid while the branch is not accepting orders", async () => {
    const p = await createOrderingWorld(c, "Paused Owner");
    await c.db
      .update(branchSettings)
      .set({ acceptingOrders: false })
      .where(eq(branchSettings.branchId, p.branchId));
    expect((await call(resolveQr, { params: { token: p.table.token } })).status).toBe(404);
  });
});

describe("table sessions and guest orders", () => {
  let w: OrderingWorld;
  beforeAll(async () => {
    w = await createOrderingWorld(c, "Session Owner");
  });

  it("sets an httpOnly guest cookie; two guests share one session; rejoin reuses membership", async () => {
    const a = await join(w.table.token);
    expect(a.status).toBe(201);
    expect(a.setCookie).toMatch(/^ros_guest=/);
    expect(a.setCookie).toMatch(/HttpOnly/);
    expect(a.setCookie).toMatch(/SameSite=Lax/);
    expect(a.setCookie).toMatch(/Path=\//);
    expect(a.setCookie).toMatch(/Max-Age=43200/);
    const b = await join(w.table.token);
    expect(b.body.data!.sessionId).toBe(a.body.data!.sessionId);

    const again = await join(w.table.token, cookieFrom(a.setCookie));
    expect(again.status).toBe(200);
    expect(again.body.data!.rejoined).toBe(true);
    expect(again.setCookie).toBeNull();

    const qr = await call<PublicQrDto>(resolveQr, { params: { token: w.table.token } });
    expect(qr.body.data!.hasOpenSession).toBe(true);
  });

  it("collapses concurrent joins into one open session", async () => {
    const t = await insertTableWithQr(c, {
      workspaceId: w.workspaceId,
      restaurantId: w.restaurantId,
      branchId: w.branchId,
    });
    const results = await Promise.all([join(t.token), join(t.token), join(t.token)]);
    const ids = new Set(results.map((r) => r.body.data!.sessionId));
    expect(ids.size).toBe(1);
    const open = await c.db
      .select()
      .from(tableSessions)
      .where(eq(tableSessions.tableId, t.tableId));
    expect(open).toHaveLength(1);
  });

  it("requires a guest cookie", async () => {
    const res = await call(getSession);
    expect(res.status).toBe(401);
    expect((await call(placeOrder, { body: { idempotencyKey: key(), lines: [] } })).status).toBe(
      422,
    );
    const noCookie = await call(placeOrder, {
      body: { idempotencyKey: key(), lines: [{ menuItemId: w.simpleItemId, quantity: 1 }] },
    });
    expect(noCookie.status).toBe(401);
  });

  it("guests see only their own orders", async () => {
    const t = await insertTableWithQr(c, {
      workspaceId: w.workspaceId,
      restaurantId: w.restaurantId,
      branchId: w.branchId,
      name: "Window 4",
    });
    const a = await guest(t.token);
    const b = await guest(t.token);
    expect(a.sessionId).toBe(b.sessionId);

    const oa = await order(a.cookie, { lines: [{ menuItemId: w.simpleItemId, quantity: 2 }] });
    expect(oa.status).toBe(201);
    expect(oa.body.data!.status).toBe("PENDING");
    const ob = await order(b.cookie, {
      lines: [{ menuItemId: w.pizza.itemId, variantId: w.pizza.variantIds[0], quantity: 1 }],
    });
    expect(ob.status).toBe(201);

    const sa = await session(a.cookie);
    expect(sa.status).toBe(200);
    expect(sa.body.data!.tableName).toBe("Window 4");
    expect(sa.body.data!.orders.map((o) => o.id)).toEqual([oa.body.data!.id]);
    const sb = await session(b.cookie);
    expect(sb.body.data!.orders.map((o) => o.id)).toEqual([ob.body.data!.id]);
    expect(JSON.stringify(sa.body.data)).not.toContain(ob.body.data!.id);
    expect(sa.body.data!.orders[0]!.timeline[0]!.status).toBe("PENDING");
    expect(sa.body.data!.canOrder).toBe(true);
    expect(sa.body.data!.bill).toBeNull();
  });

  it("reprices every line on the server and snapshots names and prices", async () => {
    const g = await guest(w.table.token);
    const res = await order(g.cookie, {
      lines: [
        {
          menuItemId: w.pizza.itemId,
          variantId: w.pizza.variantIds[1],
          addonIds: [w.pizza.addonIds[0], w.pizza.addonIds[1]],
          quantity: 2,
          notes: "  well done  ",
          // Client-side prices are ignored entirely.
          unitPrice: 1,
          lineTotal: 2,
        },
      ],
      subtotal: 2,
      specialInstructions: "No onions please",
    });
    expect(res.status).toBe(201);
    const o = res.body.data!;
    expect(o.subtotal).toBe((45_000 + 5_000 + 4_000) * 2);
    expect(o.items[0]).toMatchObject({
      itemName: "Margherita Pizza",
      variantName: "Large",
      quantity: 2,
      lineTotal: 108_000,
      notes: "well done",
    });
    expect(o.items[0]!.addons.map((a) => a.name)).toEqual(["Olives", "Jalapeño"]);

    const [row] = await c.db.select().from(orders).where(eq(orders.id, o.id));
    expect(row).toMatchObject({ source: "CUSTOMER", status: "PENDING", itemCount: 2 });
    expect(row!.specialInstructions).toBe("No onions please");
    const [item] = await c.db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    expect(item).toMatchObject({
      categoryName: "Mains",
      dietary: "VEG",
      baseUnitPrice: 45_000,
      addonsUnitTotal: 9_000,
      unitPrice: 54_000,
    });
    const addonRows = await c.db
      .select()
      .from(orderItemAddons)
      .where(eq(orderItemAddons.orderItemId, item!.id));
    expect(addonRows.map((a) => a.price).sort()).toEqual([4_000, 5_000]);
    const history = await c.db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, o.id));
    expect(history).toEqual([expect.objectContaining({ toStatus: "PENDING", actorType: "GUEST" })]);
    const audit = await c.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "order.created"), eq(auditLogs.targetId, o.id)));
    expect(audit[0]!.actorType).toBe("GUEST");
  });

  it("notifies staff who can approve orders", async () => {
    const g = await guest(w.table.token);
    const res = await order(g.cookie, { lines: [{ menuItemId: w.simpleItemId, quantity: 1 }] });
    const rows = await c.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, w.owner.userId), eq(notifications.type, "order.created")));
    expect(rows.some((n) => (n.data as { orderId?: string }).orderId === res.body.data!.id)).toBe(
      true,
    );
  });

  it("rejects unavailable items and invalid selections with field errors", async () => {
    const g = await guest(w.table.token);
    const soldOut = await order(g.cookie, { lines: [{ menuItemId: w.soldOutItemId, quantity: 1 }] });
    expect(soldOut.status).toBe(422);
    expect(soldOut.body.error!.fieldErrors!["lines.0.item"]).toBeDefined();

    const bad = await order(g.cookie, {
      lines: [
        { menuItemId: w.simpleItemId, quantity: 1 },
        {
          menuItemId: w.pizza.itemId,
          variantId: w.pizza.variantIds[0],
          addonIds: w.pizza.addonIds, // 3 > max 2
          quantity: 1,
        },
        { menuItemId: w.pizza.itemId, quantity: 1 }, // missing variant
        { menuItemId: crypto.randomUUID(), quantity: 1 },
      ],
    });
    expect(bad.status).toBe(422);
    const fe = bad.body.error!.fieldErrors!;
    expect(fe[`lines.1.addonGroups.${w.pizza.groupId}`]).toBeDefined();
    expect(fe["lines.2.variantId"]).toBeDefined();
    expect(fe["lines.3.menuItemId"]).toBeDefined();
    expect(Object.keys(fe).some((k) => k.startsWith("lines.0"))).toBe(false);

    const tooMany = await order(g.cookie, { lines: [{ menuItemId: w.simpleItemId, quantity: 100 }] });
    expect(tooMany.status).toBe(422);
    expect((await session(g.cookie)).body.data!.orders).toHaveLength(0);
  });

  it("replays an idempotent submission without duplicating it", async () => {
    const g = await guest(w.table.token);
    const body = {
      idempotencyKey: key(),
      lines: [{ menuItemId: w.simpleItemId, quantity: 1 }],
    };
    const first = await call<GuestOrderDto>(placeOrder, { body, cookie: g.cookie });
    const second = await call<GuestOrderDto>(placeOrder, { body, cookie: g.cookie });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data!.id).toBe(first.body.data!.id);
    expect(second.body.data!.orderNumber).toBe(first.body.data!.orderNumber);
    const rows = await c.db
      .select()
      .from(orders)
      .where(and(eq(orders.branchId, w.branchId), eq(orders.idempotencyKey, body.idempotencyKey)));
    expect(rows).toHaveLength(1);

    // Concurrent retries of the same submission also collapse to one order.
    const concurrent = { idempotencyKey: key(), lines: body.lines };
    const results = await Promise.all(
      [1, 2, 3].map(() => call<GuestOrderDto>(placeOrder, { body: concurrent, cookie: g.cookie })),
    );
    expect(new Set(results.map((r) => r.body.data!.id)).size).toBe(1);

    // Another guest cannot reuse (or read through) someone else's key.
    const other = await guest(w.table.token);
    const stolen = await call(placeOrder, { body, cookie: other.cookie });
    expect(stolen.status).toBe(422);
    expect(stolen.body.error!.code).toBe("IDEMPOTENCY_MISMATCH");
  });

  it("numbers orders sequentially per branch", async () => {
    const g = await guest(w.table.token);
    const lines = [{ menuItemId: w.simpleItemId, quantity: 1 }];
    const n1 = (await order(g.cookie, { lines })).body.data!.orderNumber;
    const n2 = (await order(g.cookie, { lines })).body.data!.orderNumber;
    expect(n2).toBe(n1 + 1);

    const other = await createOrderingWorld(c, "Numbering Owner");
    const og = await guest(other.table.token);
    const first = await order(og.cookie, { lines: [{ menuItemId: other.simpleItemId, quantity: 1 }] });
    expect(first.body.data!.orderNumber).toBe(1);
  });

  it("refuses orders once the table is billed or closed, but keeps the bill visible", async () => {
    const t = await insertTableWithQr(c, {
      workspaceId: w.workspaceId,
      restaurantId: w.restaurantId,
      branchId: w.branchId,
    });
    const g = await guest(t.token);
    await order(g.cookie, { lines: [{ menuItemId: w.simpleItemId, quantity: 2 }] });

    await c.db
      .update(tableSessions)
      .set({ status: "BILLED" })
      .where(eq(tableSessions.id, g.sessionId));
    const [bill] = await c.db
      .insert(bills)
      .values({
        workspaceId: w.workspaceId,
        restaurantId: w.restaurantId,
        branchId: w.branchId,
        tableId: t.tableId,
        sessionId: g.sessionId,
        billNumber: 900 + keyCounter,
        currency: "INR",
        subtotal: 50_000,
        pricesIncludeTax: false,
        taxBreakdown: [{ name: "GST", rateBps: 500, amount: 2_500 }],
        taxTotal: 2_500,
        grandTotal: 52_500,
        balanceDue: 52_500,
        issuedBy: w.owner.userId,
      })
      .returning({ id: bills.id });
    await c.db.insert(billItems).values({
      workspaceId: w.workspaceId,
      billId: bill!.id,
      orderNumber: 1,
      name: "Paneer Tikka",
      quantity: 2,
      unitPrice: 25_000,
      lineTotal: 50_000,
    });

    const billed = await order(g.cookie, { lines: [{ menuItemId: w.simpleItemId, quantity: 1 }] });
    expect(billed.status).toBe(409);
    const s = await session(g.cookie);
    expect(s.body.data!.session.status).toBe("BILLED");
    expect(s.body.data!.canOrder).toBe(false);
    expect(s.body.data!.bill).toMatchObject({ grandTotal: 52_500, balanceDue: 52_500 });
    expect(s.body.data!.bill!.items).toHaveLength(1);
    expect(JSON.stringify(s.body.data!.bill)).not.toContain(w.owner.userId);
    expect(s.body.data!.bill).not.toHaveProperty("issuedByName");
    expect(s.body.data!.bill).not.toHaveProperty("payments");

    await c.db
      .update(tableSessions)
      .set({ status: "CLOSED", closedAt: new Date() })
      .where(eq(tableSessions.id, g.sessionId));
    expect((await session(g.cookie)).body.data!.session.status).toBe("CLOSED");
    const closed = await order(g.cookie, { lines: [{ menuItemId: w.simpleItemId, quantity: 1 }] });
    expect(closed.status).toBe(409);

    // Scanning again with the old cookie starts a fresh session with a new cookie.
    const rejoin = await join(t.token, g.cookie);
    expect(rejoin.status).toBe(201);
    expect(rejoin.body.data!.sessionId).not.toBe(g.sessionId);
    expect(rejoin.setCookie).toMatch(/^ros_guest=/);
  });

  it("blocks cross-site order submissions", async () => {
    const g = await guest(w.table.token);
    const res = await call(placeOrder, {
      body: { idempotencyKey: key(), lines: [{ menuItemId: w.simpleItemId, quantity: 1 }] },
      cookie: g.cookie,
      origin: "https://evil.example",
    });
    expect(res.status).toBe(403);
  });
});

describe("bill request", () => {
  it("moves the session to BILL_REQUESTED once, notifying billing staff", async () => {
    const w = await createOrderingWorld(c, "Bill Owner");
    const g = await guest(w.table.token);

    const early = await call(billRequest, { method: "POST", cookie: g.cookie });
    expect(early.status).toBe(409);

    await order(g.cookie, { lines: [{ menuItemId: w.simpleItemId, quantity: 1 }] });
    expect((await session(g.cookie)).body.data!.canRequestBill).toBe(true);

    const res = await call<BillRequestResultDto>(billRequest, { method: "POST", cookie: g.cookie });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "BILL_REQUESTED", alreadyRequested: false });
    const again = await call<BillRequestResultDto>(billRequest, { method: "POST", cookie: g.cookie });
    expect(again.body.data!.alreadyRequested).toBe(true);

    const s = await session(g.cookie);
    expect(s.body.data!.session.status).toBe("BILL_REQUESTED");
    expect(s.body.data!.canRequestBill).toBe(false);
    // Guests can still add items after asking for the bill.
    expect(s.body.data!.canOrder).toBe(true);

    const notes = await c.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, w.owner.userId), eq(notifications.type, "bill.requested")));
    expect(notes).toHaveLength(1);
  });

  it("is refused when the branch disables customer bill requests", async () => {
    const w = await createOrderingWorld(c, "No Bill Owner");
    await c.db
      .update(branchSettings)
      .set({ allowCustomerBillRequest: false })
      .where(eq(branchSettings.branchId, w.branchId));
    const g = await guest(w.table.token);
    await order(g.cookie, { lines: [{ menuItemId: w.simpleItemId, quantity: 1 }] });
    expect((await session(g.cookie)).body.data!.allowBillRequest).toBe(false);
    const res = await call(billRequest, { method: "POST", cookie: g.cookie });
    expect(res.status).toBe(403);
  });
});

describe("staff order placement", () => {
  let w: OrderingWorld;
  beforeAll(async () => {
    w = await createOrderingWorld(c, "Staff Owner");
  });

  const staffBody = (tableId: string, extra: Record<string, unknown> = {}) => ({
    tableId,
    idempotencyKey: key(),
    lines: [{ menuItemId: w.simpleItemId, quantity: 3 }],
    ...extra,
  });

  it("creates an ACCEPTED staff order, opening the session when needed", async () => {
    const t = await insertTableWithQr(c, {
      workspaceId: w.workspaceId,
      restaurantId: w.restaurantId,
      branchId: w.branchId,
    });
    const res = await call<OrderDto>(staffOrder, {
      params: { branchId: w.branchId },
      body: staffBody(t.tableId, { priority: "RUSH" }),
      cookie: w.owner.cookie,
    });
    expect(res.status).toBe(201);
    const o = res.body.data!;
    expect(o).toMatchObject({ source: "STAFF", status: "ACCEPTED", priority: "RUSH", subtotal: 75_000 });
    expect(o.tableId).toBe(t.tableId);
    const [row] = await c.db.select().from(orders).where(eq(orders.id, o.id));
    expect(row!.acceptedBy).toBe(w.owner.userId);
    expect(row!.placedByUserId).toBe(w.owner.userId);
    const history = await c.db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, o.id));
    expect(history.map((h) => `${h.fromStatus}->${h.toStatus}`).sort()).toEqual([
      "PENDING->ACCEPTED",
      "null->PENDING",
    ]);
    const [s] = await c.db.select().from(tableSessions).where(eq(tableSessions.id, o.sessionId));
    expect(s!.openedBy).toBe(w.owner.userId);

    // A guest joining that table lands in the same session but doesn't see the staff order.
    const g = await guest(t.token);
    expect(g.sessionId).toBe(o.sessionId);
    expect((await session(g.cookie)).body.data!.orders).toHaveLength(0);
  });

  it("is idempotent for the same staff member", async () => {
    const body = staffBody(w.table.tableId);
    const a = await call<OrderDto>(staffOrder, {
      params: { branchId: w.branchId },
      body,
      cookie: w.owner.cookie,
    });
    const b = await call<OrderDto>(staffOrder, {
      params: { branchId: w.branchId },
      body,
      cookie: w.owner.cookie,
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.data!.id).toBe(a.body.data!.id);
  });

  it("allows waiters and denies kitchen staff", async () => {
    const waiter = await signUpUser("Wanda Waiter");
    await addStaffMember(c, {
      workspaceId: w.workspaceId,
      userId: waiter.userId,
      role: "waiter",
      restaurantId: w.restaurantId,
      branchId: w.branchId,
    });
    const cook = await signUpUser("Kofi Cook");
    await addStaffMember(c, {
      workspaceId: w.workspaceId,
      userId: cook.userId,
      role: "kitchen_staff",
      restaurantId: w.restaurantId,
      branchId: w.branchId,
    });
    const ok = await call(staffOrder, {
      params: { branchId: w.branchId },
      body: staffBody(w.table.tableId),
      cookie: waiter.cookie,
    });
    expect(ok.status).toBe(201);
    const denied = await call(staffOrder, {
      params: { branchId: w.branchId },
      body: staffBody(w.table.tableId),
      cookie: cook.cookie,
    });
    expect(denied.status).toBe(403);
  });

  it("validates lines and hides other tenants' branches and tables", async () => {
    const invalid = await call(staffOrder, {
      params: { branchId: w.branchId },
      body: staffBody(w.table.tableId, { lines: [{ menuItemId: w.soldOutItemId, quantity: 1 }] }),
      cookie: w.owner.cookie,
    });
    expect(invalid.status).toBe(422);
    expect(invalid.body.error!.fieldErrors!["lines.0.item"]).toBeDefined();

    const other = await createOrderingWorld(c, "Other Staff Owner");
    const crossBranch = await call(staffOrder, {
      params: { branchId: w.branchId },
      body: staffBody(w.table.tableId),
      cookie: other.owner.cookie,
    });
    expect(crossBranch.status).toBe(404);
    // Own branch, but a table id from another workspace.
    const crossTable = await call(staffOrder, {
      params: { branchId: other.branchId },
      body: { ...staffBody(w.table.tableId), lines: [{ menuItemId: other.simpleItemId, quantity: 1 }] },
      cookie: other.owner.cookie,
    });
    expect(crossTable.status).toBe(404);
    // Another workspace's menu item cannot be priced in this branch.
    const crossItem = await call(staffOrder, {
      params: { branchId: other.branchId },
      body: staffBody(other.table.tableId),
      cookie: other.owner.cookie,
    });
    expect(crossItem.status).toBe(422);

    // A table in a second branch of the same restaurant is not part of this branch.
    const second = await insertRestaurantWithBranch(c, w.workspaceId, { name: "Second Place" });
    const t2 = await insertTableWithQr(c, {
      workspaceId: w.workspaceId,
      restaurantId: second.restaurantId,
      branchId: second.branchId,
    });
    const wrongBranch = await call(staffOrder, {
      params: { branchId: w.branchId },
      body: staffBody(t2.tableId),
      cookie: w.owner.cookie,
    });
    expect(wrongBranch.status).toBe(404);
  });

  it("requires a signed-in staff user (a guest cookie is not enough)", async () => {
    const g = await guest(w.table.token);
    const res = await call(staffOrder, {
      params: { branchId: w.branchId },
      body: staffBody(w.table.tableId),
      cookie: g.cookie,
    });
    expect(res.status).toBe(401);
  });
});

describe("tenant isolation for guests", () => {
  it("a guest cookie from workspace A reveals nothing about workspace B", async () => {
    const a = await createOrderingWorld(c, "Tenant A");
    const b = await createOrderingWorld(c, "Tenant B");
    const ga = await guest(a.table.token);
    const gb = await guest(b.table.token);
    const ob = await order(gb.cookie, { lines: [{ menuItemId: b.simpleItemId, quantity: 1 }] });
    expect(ob.status).toBe(201);

    const sa = await session(ga.cookie);
    expect(sa.body.data!.session.id).toBe(ga.sessionId);
    expect(sa.body.data!.restaurantName).toBe("Spice Garden");
    expect(JSON.stringify(sa.body.data)).not.toContain(ob.body.data!.id);
    expect(JSON.stringify(sa.body.data)).not.toContain(gb.sessionId);

    // Ordering B's item with A's cookie is priced against A's menu → rejected.
    const crossItem = await order(ga.cookie, { lines: [{ menuItemId: b.simpleItemId, quantity: 1 }] });
    expect(crossItem.status).toBe(422);
    // A's guest cannot use B's staff endpoints.
    const staff = await call(staffOrder, {
      params: { branchId: b.branchId },
      body: { tableId: b.table.tableId, idempotencyKey: key(), lines: [{ menuItemId: b.simpleItemId, quantity: 1 }] },
      cookie: ga.cookie,
    });
    expect(staff.status).toBe(401);

    // Scanning B's QR with A's cookie starts a separate membership in B; A's cookie is unchanged.
    const scan = await join(b.table.token, ga.cookie);
    expect(scan.status).toBe(201);
    expect(scan.body.data!.sessionId).toBe(gb.sessionId);
    const asB = await session(cookieFrom(scan.setCookie));
    expect(asB.body.data!.orders).toHaveLength(0);
    expect((await session(ga.cookie)).body.data!.session.id).toBe(ga.sessionId);
  });
});
