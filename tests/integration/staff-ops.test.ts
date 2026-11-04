import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as listOrders } from "@/app/api/v1/branches/[branchId]/orders/route";
import { GET as branchEvents } from "@/app/api/v1/branches/[branchId]/events/route";
import { GET as kitchenFeed } from "@/app/api/v1/branches/[branchId]/kitchen/route";
import { GET as getSession } from "@/app/api/v1/branches/[branchId]/sessions/[sessionId]/route";
import { GET as listSessions } from "@/app/api/v1/branches/[branchId]/sessions/route";
import { PATCH as patchItem } from "@/app/api/v1/orders/[orderId]/items/[itemId]/route";
import { PATCH as patchPriority } from "@/app/api/v1/orders/[orderId]/priority/route";
import { GET as getOrder } from "@/app/api/v1/orders/[orderId]/route";
import { POST as transition } from "@/app/api/v1/orders/[orderId]/transition/route";
import type { OrderDto } from "@/contracts/orders";
import type { BranchSessionsDto, KitchenFeedDto, SessionDetailDto } from "@/contracts/staff-ops";
import {
  auditLogs,
  notifications,
  orderItems,
  orderStatusHistory,
  orders,
} from "@/infrastructure/database/providers/postgres/schema";
import type { Container } from "@/server/container";
import type { TestUser } from "@/test/fixtures";
import {
  addStaff,
  insertBill,
  insertMenuItem,
  insertOrder,
  insertSiblingBranch,
  insertTable,
  openSession,
  setupBranch,
  type TestBranch,
} from "@/test/fixtures-staff-ops";
import { call, createTestContainer, TEST_ORIGIN } from "@/test/harness";

let c: Container;
let branch: TestBranch;
let waiter: TestUser;
let kitchen: TestUser;
let cashier: TestUser;
let tableId: string;
let sessionId: string;
let burgerId: string;
let friesId: string;

beforeAll(async () => {
  c = await createTestContainer();
  branch = await setupBranch(c);
  waiter = await addStaff(c, branch, "waiter", "Wanda Waiter");
  kitchen = await addStaff(c, branch, "kitchen_staff", "Kiran Cook");
  cashier = await addStaff(c, branch, "cashier", "Cass Cashier");
  tableId = await insertTable(c, branch, "T1");
  sessionId = await openSession(c, branch, tableId);
  burgerId = await insertMenuItem(c, branch, "Burger", { prepTimeMinutes: 12 });
  friesId = await insertMenuItem(c, branch, "Fries", { prepTimeMinutes: 25 });
});
afterAll(async () => {
  await c.close();
});

function newOrder(lines = [{ name: "Burger" }, { name: "Fries" }]) {
  return insertOrder(c, branch, {
    tableId,
    sessionId,
    specialInstructions: "No onions",
    lines: lines.map((l) => ({
      ...l,
      menuItemId: l.name === "Burger" ? burgerId : l.name === "Fries" ? friesId : null,
    })),
  });
}

function act(
  user: TestUser,
  orderId: string,
  action: string,
  expectedVersion: number,
  reason?: string,
) {
  return call<OrderDto>(transition, {
    method: "POST",
    params: { orderId },
    body: { action, expectedVersion, ...(reason ? { reason } : {}) },
    cookie: user.cookie,
  });
}

describe("order lifecycle", () => {
  it("runs PENDING → ACCEPTED → PREPARING → READY → SERVED with timestamps, history and audit", async () => {
    const { orderId } = await newOrder();

    const accepted = await act(waiter, orderId, "accept", 1);
    expect(accepted.status).toBe(200);
    const a = accepted.body.data!;
    expect(a.status).toBe("ACCEPTED");
    expect(a.version).toBe(2);
    expect(a.acceptedAt).not.toBeNull();
    expect(a.acceptedByName).toBe("Wanda Waiter");
    expect(a.items.every((i) => i.status === "PENDING")).toBe(true);
    expect(a.items[0]!.addons[0]!.name).toBe("Extra hot");

    const started = await act(kitchen, orderId, "start", 2);
    expect(started.status).toBe(200);
    expect(started.body.data!.status).toBe("PREPARING");
    expect(started.body.data!.preparingAt).not.toBeNull();
    expect(started.body.data!.items.every((i) => i.status === "PREPARING")).toBe(true);

    const ready = await act(kitchen, orderId, "ready", 3);
    expect(ready.body.data!.status).toBe("READY");
    expect(ready.body.data!.readyAt).not.toBeNull();
    expect(ready.body.data!.items.every((i) => i.status === "READY")).toBe(true);

    const served = await act(waiter, orderId, "serve", 4);
    expect(served.status).toBe(200);
    const s = served.body.data!;
    expect(s.status).toBe("SERVED");
    expect(s.servedAt).not.toBeNull();
    expect(s.items.every((i) => i.status === "SERVED")).toBe(true);

    const [row] = await c.db.select().from(orders).where(eq(orders.id, orderId));
    expect(row!.servedBy).toBe(waiter.userId);
    expect(row!.acceptedBy).toBe(waiter.userId);

    const history = await c.db
      .select()
      .from(orderStatusHistory)
      .where(eq(orderStatusHistory.orderId, orderId));
    expect(history.map((h) => h.toStatus)).toEqual(
      expect.arrayContaining(["PENDING", "ACCEPTED", "PREPARING", "READY", "SERVED"]),
    );
    expect(history).toHaveLength(5);

    const audit = await c.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.targetId, orderId));
    expect(audit.map((x) => x.action).sort()).toEqual(
      ["order.accept", "order.ready", "order.serve", "order.start"].sort(),
    );

    const detail = await call<OrderDto>(getOrder, { params: { orderId }, cookie: waiter.cookie });
    expect(detail.status).toBe(200);
    const timeline = detail.body.data!.timeline!;
    expect(timeline.map((t) => t.toStatus)).toEqual([
      "PENDING",
      "ACCEPTED",
      "PREPARING",
      "READY",
      "SERVED",
    ]);
    expect(timeline[1]!.actorName).toBe("Wanda Waiter");
    expect(timeline[2]!.actorName).toBe("Kiran Cook");
  });

  it("notifies kitchen on accept and servers on ready", async () => {
    const { orderId } = await newOrder();
    await act(waiter, orderId, "accept", 1);
    const kitchenNotes = await c.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, kitchen.userId), eq(notifications.type, "order.accepted")));
    expect(kitchenNotes.some((n) => (n.data as { orderId?: string }).orderId === orderId)).toBe(true);
    // The actor is not notified about their own action.
    const self = await c.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, waiter.userId), eq(notifications.type, "order.accepted")));
    expect(self).toHaveLength(0);

    await act(kitchen, orderId, "ready", 2);
    const waiterNotes = await c.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, waiter.userId), eq(notifications.type, "order.ready")));
    expect(waiterNotes.some((n) => (n.data as { orderId?: string }).orderId === orderId)).toBe(true);
  });

  it("rejects invalid transitions with 409 and stale versions with STALE_VERSION", async () => {
    const { orderId } = await newOrder();
    const early = await act(kitchen, orderId, "start", 1);
    expect(early.status).toBe(409);
    expect(early.body.error!.code).toBe("INVALID_STATE_TRANSITION");

    const serveEarly = await act(waiter, orderId, "serve", 1);
    expect(serveEarly.status).toBe(409);

    const stale = await act(waiter, orderId, "accept", 7);
    expect(stale.status).toBe(409);
    expect(stale.body.error!.code).toBe("STALE_VERSION");
  });

  it("requires a reason to reject (422) and records it", async () => {
    const { orderId } = await newOrder();
    const noReason = await act(waiter, orderId, "reject", 1);
    expect(noReason.status).toBe(422);
    expect(noReason.body.error!.fieldErrors!.reason).toBeDefined();

    const rejected = await act(waiter, orderId, "reject", 1, "Item unavailable");
    expect(rejected.status).toBe(200);
    expect(rejected.body.data!.status).toBe("REJECTED");
    expect(rejected.body.data!.rejectionReason).toBe("Item unavailable");
    expect(rejected.body.data!.items.every((i) => i.status === "CANCELLED")).toBe(true);
    const [row] = await c.db.select().from(orders).where(eq(orders.id, orderId));
    expect(row!.rejectedAt).not.toBeNull();
  });

  it("lets exactly one of two simultaneous accepts win", async () => {
    const waiter2 = await addStaff(c, branch, "waiter", "Second Waiter");
    const { orderId } = await newOrder();
    const results = await Promise.all([
      act(waiter, orderId, "accept", 1),
      act(waiter2, orderId, "accept", 1),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409)!;
    expect(["STALE_VERSION", "INVALID_STATE_TRANSITION"]).toContain(loser.body.error!.code);
    const history = await c.db
      .select()
      .from(orderStatusHistory)
      .where(and(eq(orderStatusHistory.orderId, orderId), eq(orderStatusHistory.toStatus, "ACCEPTED")));
    expect(history).toHaveLength(1);
  });

  it("cancels an accepted order with a reason", async () => {
    const { orderId } = await newOrder();
    await act(waiter, orderId, "accept", 1);
    const owner = branch.owner;
    const res = await act(owner, orderId, "cancel", 2, "Guest left");
    expect(res.status).toBe(200);
    expect(res.body.data!.status).toBe("CANCELLED");
    expect(res.body.data!.cancellationReason).toBe("Guest left");
  });
});

describe("role restrictions", () => {
  it("kitchen staff cannot accept or serve; waiter cannot start; cashier cannot transition", async () => {
    const { orderId } = await newOrder();
    expect((await act(kitchen, orderId, "accept", 1)).status).toBe(403);
    expect((await act(cashier, orderId, "accept", 1)).status).toBe(403);
    expect((await act(waiter, orderId, "accept", 1)).status).toBe(200);
    expect((await act(waiter, orderId, "start", 2)).status).toBe(403);
    expect((await act(cashier, orderId, "start", 2)).status).toBe(403);
    expect((await act(kitchen, orderId, "ready", 2)).status).toBe(200);
    expect((await act(kitchen, orderId, "serve", 3)).status).toBe(403);
    expect((await act(cashier, orderId, "serve", 3)).status).toBe(403);
    expect((await act(waiter, orderId, "cancel", 3, "nope")).status).toBe(403);
  });

  it("kitchen staff cannot list branch orders or tables; waiter cannot read the kitchen feed", async () => {
    const p = { branchId: branch.branchId };
    expect((await call(listOrders, { params: p, cookie: kitchen.cookie })).status).toBe(403);
    expect((await call(listSessions, { params: p, cookie: kitchen.cookie })).status).toBe(403);
    expect((await call(kitchenFeed, { params: p, cookie: waiter.cookie })).status).toBe(403);
    expect((await call(kitchenFeed, { params: p, cookie: cashier.cookie })).status).toBe(403);
  });

  it("requires sign-in", async () => {
    const { orderId } = await newOrder();
    const res = await call(transition, {
      method: "POST",
      params: { orderId },
      body: { action: "accept", expectedVersion: 1 },
    });
    expect(res.status).toBe(401);
  });
});

describe("tenant isolation", () => {
  it("returns 404 to a waiter of another branch in the same workspace", async () => {
    const other = await insertSiblingBranch(c, branch, "Uptown");
    const otherWaiter = await addStaff(c, other, "waiter", "Uptown Waiter");
    const { orderId, itemIds } = await newOrder();

    const res = await act(otherWaiter, orderId, "accept", 1);
    expect(res.status).toBe(404);
    expect((await call(getOrder, { params: { orderId }, cookie: otherWaiter.cookie })).status).toBe(
      404,
    );
    const item = await call(patchItem, {
      method: "PATCH",
      params: { orderId, itemId: itemIds[0]! },
      body: { status: "READY" },
      cookie: otherWaiter.cookie,
    });
    expect(item.status).toBe(404);
    expect(
      (await call(listOrders, { params: { branchId: branch.branchId }, cookie: otherWaiter.cookie }))
        .status,
    ).toBe(404);
    const sess = await call(getSession, {
      params: { branchId: other.branchId, sessionId },
      cookie: otherWaiter.cookie,
    });
    expect(sess.status).toBe(404);
  });

  it("returns 404 across workspaces for every order and branch endpoint", async () => {
    const foreign = await setupBranch(c, { workspaceName: "Rival" });
    const outsider = foreign.owner;
    const { orderId, itemIds } = await newOrder();
    expect((await act(outsider, orderId, "accept", 1)).status).toBe(404);
    expect((await call(getOrder, { params: { orderId }, cookie: outsider.cookie })).status).toBe(404);
    expect(
      (
        await call(patchPriority, {
          method: "PATCH",
          params: { orderId },
          body: { priority: "RUSH", expectedVersion: 1 },
          cookie: outsider.cookie,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await call(patchItem, {
          method: "PATCH",
          params: { orderId, itemId: itemIds[0]! },
          body: { status: "READY" },
          cookie: outsider.cookie,
        })
      ).status,
    ).toBe(404);
    const p = { branchId: branch.branchId };
    for (const h of [listOrders, kitchenFeed, listSessions, branchEvents]) {
      expect((await call(h, { params: p, cookie: outsider.cookie })).status).toBe(404);
    }
    expect(
      (await call(getSession, { params: { ...p, sessionId }, cookie: outsider.cookie })).status,
    ).toBe(404);
    // A session of another workspace's branch is not readable through one's own branch.
    expect(
      (
        await call(getSession, {
          params: { branchId: foreign.branchId, sessionId },
          cookie: outsider.cookie,
        })
      ).status,
    ).toBe(404);
    // Unknown order ids look the same as foreign ones.
    expect(
      (
        await call(getOrder, {
          params: { orderId: "00000000-0000-4000-8000-000000000000" },
          cookie: outsider.cookie,
        })
      ).status,
    ).toBe(404);
  });
});

describe("kitchen feed", () => {
  it("excludes PENDING orders, includes expected prep time and recent served orders", async () => {
    const pending = await newOrder();
    const active = await newOrder();
    await act(waiter, active.orderId, "accept", 1);
    const done = await newOrder([{ name: "Burger" }]);
    await act(waiter, done.orderId, "accept", 1);
    await act(kitchen, done.orderId, "ready", 2);
    await act(waiter, done.orderId, "serve", 3);

    const res = await call<KitchenFeedDto>(kitchenFeed, {
      params: { branchId: branch.branchId },
      cookie: kitchen.cookie,
    });
    expect(res.status).toBe(200);
    const feed = res.body.data!;
    expect(feed.active.some((o) => o.id === pending.orderId)).toBe(false);
    expect(feed.active.every((o) => ["ACCEPTED", "PREPARING", "READY"].includes(o.status))).toBe(
      true,
    );
    const ticket = feed.active.find((o) => o.id === active.orderId)!;
    expect(ticket.expectedPrepMinutes).toBe(25);
    expect(ticket.specialInstructions).toBe("No onions");
    expect(feed.recent.some((o) => o.id === done.orderId)).toBe(true);
    expect(feed.recent.find((o) => o.id === done.orderId)!.expectedPrepMinutes).toBe(12);
    expect(feed.kitchenDelayMinutes).toBe(20);
    expect(feed.kitchenSoundEnabled).toBe(true);
  });
});

describe("item-level kitchen status", () => {
  function setItem(user: TestUser, orderId: string, itemId: string, status: string) {
    return call<OrderDto>(patchItem, {
      method: "PATCH",
      params: { orderId, itemId },
      body: { status },
      cookie: user.cookie,
    });
  }

  it("starts the order on the first item and auto-readies when all items are ready", async () => {
    const { orderId, itemIds } = await newOrder();
    expect((await setItem(kitchen, orderId, itemIds[0]!, "READY")).status).toBe(409); // still PENDING
    await act(waiter, orderId, "accept", 1);

    expect((await setItem(waiter, orderId, itemIds[0]!, "PREPARING")).status).toBe(403);

    const first = await setItem(kitchen, orderId, itemIds[0]!, "PREPARING");
    expect(first.status).toBe(200);
    expect(first.body.data!.status).toBe("PREPARING");

    const one = await setItem(kitchen, orderId, itemIds[0]!, "READY");
    expect(one.body.data!.status).toBe("PREPARING");
    const all = await setItem(kitchen, orderId, itemIds[1]!, "READY");
    expect(all.status).toBe(200);
    expect(all.body.data!.status).toBe("READY");
    expect(all.body.data!.readyAt).not.toBeNull();
    expect(all.body.data!.items.every((i) => i.status === "READY")).toBe(true);

    const history = await c.db
      .select()
      .from(orderStatusHistory)
      .where(and(eq(orderStatusHistory.orderId, orderId), eq(orderStatusHistory.toStatus, "READY")));
    expect(history).toHaveLength(1);
    expect(history[0]!.reason).toBe("All items ready");

    // Order is READY: further item changes are refused.
    expect((await setItem(kitchen, orderId, itemIds[0]!, "PREPARING")).status).toBe(409);
  });

  it("serializes concurrent last-item updates so the order still auto-readies", async () => {
    const { orderId, itemIds } = await newOrder();
    await act(waiter, orderId, "accept", 1);
    const results = await Promise.all(
      itemIds.map((id) => setItem(kitchen, orderId, id, "READY")),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const [row] = await c.db.select().from(orders).where(eq(orders.id, orderId));
    expect(row!.status).toBe("READY");
    const items = await c.db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    expect(items.every((i) => i.status === "READY")).toBe(true);
  });
});

describe("priority", () => {
  it("lets waiters and kitchen change priority with version checks; cashier cannot", async () => {
    const { orderId } = await newOrder();
    const res = await call<OrderDto>(patchPriority, {
      method: "PATCH",
      params: { orderId },
      body: { priority: "RUSH", expectedVersion: 1 },
      cookie: waiter.cookie,
    });
    expect(res.status).toBe(200);
    expect(res.body.data!.priority).toBe("RUSH");
    expect(res.body.data!.version).toBe(2);

    const stale = await call(patchPriority, {
      method: "PATCH",
      params: { orderId },
      body: { priority: "HIGH", expectedVersion: 1 },
      cookie: kitchen.cookie,
    });
    expect(stale.status).toBe(409);

    const k = await call<OrderDto>(patchPriority, {
      method: "PATCH",
      params: { orderId },
      body: { priority: "HIGH", expectedVersion: 2 },
      cookie: kitchen.cookie,
    });
    expect(k.status).toBe(200);
    expect(k.body.data!.priority).toBe("HIGH");

    const cash = await call(patchPriority, {
      method: "PATCH",
      params: { orderId },
      body: { priority: "NORMAL", expectedVersion: 3 },
      cookie: cashier.cookie,
    });
    expect(cash.status).toBe(403);
  });
});

describe("order list", () => {
  it("filters by status, table, session and order number, newest first", async () => {
    const t2 = await insertTable(c, branch, "T2-list");
    const s2 = await openSession(c, branch, t2);
    const o1 = await insertOrder(c, branch, { tableId: t2, sessionId: s2, lines: [{ name: "Tea" }] });
    const o2 = await insertOrder(c, branch, { tableId: t2, sessionId: s2, lines: [{ name: "Cake" }] });
    await act(waiter, o2.orderId, "accept", 1);

    const p = { branchId: branch.branchId };
    const byTable = await call<OrderDto[]>(listOrders, {
      params: p,
      path: `/api/v1/branches/${branch.branchId}/orders?tableId=${t2}`,
      cookie: cashier.cookie,
    });
    expect(byTable.status).toBe(200);
    expect(byTable.body.data!.map((o) => o.id)).toEqual([o2.orderId, o1.orderId]);

    const pending = await call<OrderDto[]>(listOrders, {
      params: p,
      path: `/api/v1/branches/${branch.branchId}/orders?sessionId=${s2}&status=PENDING`,
      cookie: waiter.cookie,
    });
    expect(pending.body.data!.map((o) => o.id)).toEqual([o1.orderId]);

    const multi = await call<OrderDto[]>(listOrders, {
      params: p,
      path: `/api/v1/branches/${branch.branchId}/orders?sessionId=${s2}&status=PENDING,ACCEPTED`,
      cookie: waiter.cookie,
    });
    expect(multi.body.data).toHaveLength(2);

    const byNumber = await call<OrderDto[]>(listOrders, {
      params: p,
      path: `/api/v1/branches/${branch.branchId}/orders?orderNumber=${o1.orderNumber}`,
      cookie: waiter.cookie,
    });
    expect(byNumber.body.data!.map((o) => o.id)).toEqual([o1.orderId]);

    const bad = await call(listOrders, {
      params: p,
      path: `/api/v1/branches/${branch.branchId}/orders?status=BOGUS`,
      cookie: waiter.cookie,
    });
    expect(bad.status).toBe(422);
  });
});

describe("table sessions", () => {
  it("derives table statuses and summarizes sessions and bills", async () => {
    const b = await setupBranch(c, { workspaceName: "Sessions WS" });
    const w = await addStaff(c, b, "waiter", "Session Waiter");
    const free = await insertTable(c, b, "A1");
    const occupied = await insertTable(c, b, "A2");
    const requested = await insertTable(c, b, "A3");
    const billed = await insertTable(c, b, "A4");
    const partial = await insertTable(c, b, "A5");
    await insertTable(c, b, "A6", { isActive: false });

    const occSession = await openSession(c, b, occupied);
    await insertOrder(c, b, { tableId: occupied, sessionId: occSession, lines: [{ name: "Tea" }] });
    const acceptedOrder = await insertOrder(c, b, {
      tableId: occupied,
      sessionId: occSession,
      status: "ACCEPTED",
      lines: [{ name: "Cake", unitPrice: 10_000, quantity: 2 }],
    });
    await openSession(c, b, requested, "BILL_REQUESTED");
    const billedSession = await openSession(c, b, billed, "BILLED");
    const billId = await insertBill(c, b, {
      tableId: billed,
      sessionId: billedSession,
      grandTotal: 50_000,
    });
    const partialSession = await openSession(c, b, partial, "BILLED");
    await insertBill(c, b, {
      tableId: partial,
      sessionId: partialSession,
      grandTotal: 50_000,
      balanceDue: 20_000,
      paymentStatus: "PARTIALLY_PAID",
    });

    const res = await call<BranchSessionsDto>(listSessions, {
      params: { branchId: b.branchId },
      cookie: w.cookie,
    });
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.data!.tables.map((t) => [t.tableName, t]));
    expect(byName.A1!.status).toBe("AVAILABLE");
    expect(byName.A1!.session).toBeNull();
    expect(byName.A2!.status).toBe("OCCUPIED");
    expect(byName.A2!.session!.pendingCount).toBe(1);
    expect(byName.A2!.session!.orderCounts).toEqual({ PENDING: 1, ACCEPTED: 1 });
    expect(byName.A2!.session!.billableSubtotal).toBe(20_000);
    expect(byName.A3!.status).toBe("BILL_REQUESTED");
    expect(byName.A3!.session!.billRequestedAt).not.toBeNull();
    expect(byName.A4!.status).toBe("BILL_GENERATED");
    expect(byName.A4!.bill).toMatchObject({ billId, paymentStatus: "UNPAID", balanceDue: 50_000 });
    expect(byName.A5!.status).toBe("PAYMENT_PENDING");
    expect(byName.A6!.status).toBe("CLOSED");
    expect(res.body.data!.waiterSoundEnabled).toBe(true);
    expect(free).toBeTruthy();

    const detail = await call<SessionDetailDto>(getSession, {
      params: { branchId: b.branchId, sessionId: occSession },
      cookie: w.cookie,
    });
    expect(detail.status).toBe(200);
    expect(detail.body.data!.orders).toHaveLength(2);
    expect(detail.body.data!.orders[0]!.id).toBe(acceptedOrder.orderId);
    expect(detail.body.data!.status).toBe("OCCUPIED");
    expect(detail.body.data!.table.name).toBe("A2");

    // Kitchen staff lack tables.view.
    const k = await addStaff(c, b, "kitchen_staff");
    expect((await call(listSessions, { params: { branchId: b.branchId }, cookie: k.cookie })).status).toBe(
      403,
    );
  });
});

describe("server-sent events", () => {
  it("streams branch events and stops on disconnect", async () => {
    const controller = new AbortController();
    const req = new Request(`${TEST_ORIGIN}/api/v1/branches/${branch.branchId}/events`, {
      headers: { cookie: kitchen.cookie },
      signal: controller.signal,
    });
    const res = await branchEvents(req, { params: Promise.resolve({ branchId: branch.branchId }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("event: ready")) {
      const { value } = await reader.read();
      text += decoder.decode(value);
    }

    const { orderId } = await newOrder();
    await act(waiter, orderId, "accept", 1);
    while (!text.includes(orderId)) {
      const { value } = await reader.read();
      text += decoder.decode(value);
    }
    expect(text).toContain("event: order.updated");
    expect(text).toContain('"action":"accept"');

    controller.abort();
    const end = await reader.read();
    expect(end.done).toBe(true);
  });

  it("refuses users without orders.view or kitchen.view", async () => {
    const b = await setupBranch(c, { workspaceName: "SSE WS" });
    const member = await addStaff(c, b, "workspace_member", "Plain Member");
    const res = await call(branchEvents, {
      params: { branchId: b.branchId },
      cookie: member.cookie,
    });
    expect(res.status).toBe(404);
  });
});
