import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as adminAnalytics } from "@/app/api/v1/admin/analytics/route";
import { GET as branchAnalytics } from "@/app/api/v1/branches/[branchId]/analytics/route";
import { GET as branchLive } from "@/app/api/v1/branches/[branchId]/analytics/live/route";
import { GET as workspaceAnalytics } from "@/app/api/v1/workspaces/[workspaceId]/analytics/route";
import type {
  AdminAnalyticsDto,
  BranchAnalyticsDto,
  BranchLiveDto,
  WorkspaceAnalyticsDto,
} from "@/contracts/analytics";
import {
  subscriptionEvents,
  subscriptionPlans,
  subscriptions,
} from "@/infrastructure/database/providers/postgres/schema";
import type { Container } from "@/server/container";
import {
  addStaffMember,
  createWorkspaceAs,
  insertRestaurantWithBranch,
  signUpUser,
  type TestUser,
} from "@/test/fixtures";
import {
  insertBill,
  insertBranch,
  insertOrder,
  insertPayment,
  insertSession,
  insertTable,
  type BranchRefs,
} from "@/test/fixtures-analytics";
import { call, createTestContainer, makePlatformAdmin } from "@/test/harness";

let c: Container;
let ownerA: TestUser;
let ownerB: TestUser;
let manager: TestUser;
let waiter: TestUser;
let cook: TestUser;
let wsA: string;
let wsB: string;
let b1: BranchRefs;
let b2: BranchRefs;
let bx: BranchRefs;

const RANGE = "from=2026-03-01&to=2026-03-07";

function getBranch(user: TestUser, branchId: string, query = RANGE) {
  return call<BranchAnalyticsDto>(branchAnalytics, {
    cookie: user.cookie,
    params: { branchId },
    path: `/api/v1/branches/${branchId}/analytics?${query}`,
  });
}

function getWorkspace(user: TestUser, workspaceId: string, query = RANGE) {
  return call<WorkspaceAnalyticsDto>(workspaceAnalytics, {
    cookie: user.cookie,
    params: { workspaceId },
    path: `/api/v1/workspaces/${workspaceId}/analytics?${query}`,
  });
}

async function seedBranch1(ref: BranchRefs) {
  const t1 = await insertTable(c, ref, "T1");
  const t2 = await insertTable(c, ref, "T2");
  // Sessions in range: T1 100 + 60 min, T2 80 min. Previous period: T2.
  const s1 = await insertSession(c, ref, {
    tableId: t1,
    openedAt: "2026-03-02T06:00:00Z",
    closedAt: "2026-03-02T07:40:00Z",
  });
  const s2 = await insertSession(c, ref, {
    tableId: t2,
    openedAt: "2026-03-03T06:50:00Z",
    closedAt: "2026-03-03T08:10:00Z",
  });
  const s3 = await insertSession(c, ref, {
    tableId: t1,
    openedAt: "2026-03-07T17:50:00Z",
    closedAt: "2026-03-07T18:50:00Z",
  });
  const s0 = await insertSession(c, ref, {
    tableId: t2,
    openedAt: "2026-02-25T05:50:00Z",
    closedAt: "2026-02-25T07:00:00Z",
  });

  // O1 COMPLETED Mon 12:00 IST: wait 5, prep 20.
  await insertOrder(c, ref, {
    tableId: t1,
    sessionId: s1,
    status: "COMPLETED",
    createdAt: "2026-03-02T06:30:00Z",
    acceptedAfter: 5,
    readyAfter: 20,
    lines: [
      { name: "Paneer Tikka", category: "Starters", quantity: 2, unitPrice: 15_000 },
      { name: "Lassi", category: "Drinks", quantity: 2, unitPrice: 10_000 },
    ],
  });
  // O2 SERVED: wait 10, prep 30 (> 20 min threshold → delayed).
  await insertOrder(c, ref, {
    tableId: t2,
    sessionId: s2,
    status: "SERVED",
    createdAt: "2026-03-03T07:00:00Z",
    acceptedAfter: 10,
    readyAfter: 30,
    lines: [
      { name: "Paneer Tikka", category: "Starters", quantity: 1, unitPrice: 15_000 },
      { name: "Dal Makhani", category: "Mains", quantity: 1, unitPrice: 15_000 },
    ],
  });
  await insertOrder(c, ref, {
    tableId: t2,
    sessionId: s2,
    status: "CANCELLED",
    createdAt: "2026-03-04T08:00:00Z",
    lines: [{ name: "Lassi", category: "Drinks", quantity: 2, unitPrice: 10_000 }],
  });
  await insertOrder(c, ref, {
    tableId: t2,
    sessionId: s2,
    status: "REJECTED",
    createdAt: "2026-03-05T09:00:00Z",
    lines: [{ name: "Lassi", category: "Drinks", quantity: 1, unitPrice: 10_000 }],
  });
  // O5 at 23:30 IST on Sat 7 March (18:00 UTC) → inside the range, Saturday hour 23.
  await insertOrder(c, ref, {
    tableId: t1,
    sessionId: s3,
    status: "PENDING",
    createdAt: "2026-03-07T18:00:00Z",
    lines: [
      { name: "Dal Makhani", category: "Mains", quantity: 1, unitPrice: 15_000 },
      { name: "Lassi", category: "Drinks", quantity: 1, unitPrice: 10_000 },
    ],
  });
  // O6 at 00:30 IST on 8 March (19:00 UTC on the 7th) → outside the range.
  await insertOrder(c, ref, {
    tableId: t1,
    sessionId: s3,
    status: "PENDING",
    createdAt: "2026-03-07T19:00:00Z",
    lines: [{ name: "Late Snack", category: "Starters", quantity: 1, unitPrice: 99_900 }],
  });
  // Previous period order.
  await insertOrder(c, ref, {
    tableId: t2,
    sessionId: s0,
    status: "COMPLETED",
    createdAt: "2026-02-25T06:00:00Z",
    lines: [
      { name: "Dal Makhani", category: "Mains", quantity: 2, unitPrice: 15_000 },
      { name: "Lassi", category: "Drinks", quantity: 1, unitPrice: 10_000 },
    ],
  });

  const bill1 = await insertBill(c, ref, {
    tableId: t1,
    sessionId: s1,
    grandTotal: 52_500,
    amountPaid: 52_500,
    issuedAt: "2026-03-02T07:30:00Z",
  });
  const bill2 = await insertBill(c, ref, {
    tableId: t2,
    sessionId: s2,
    grandTotal: 31_500,
    amountPaid: 20_000,
    discount: 1_000,
    issuedAt: "2026-03-03T08:00:00Z",
  });
  await insertBill(c, ref, {
    tableId: t1,
    sessionId: s3,
    grandTotal: 99_999,
    amountPaid: 0,
    status: "VOID",
    issuedAt: "2026-03-04T08:00:00Z",
  });
  const bill0 = await insertBill(c, ref, {
    tableId: t2,
    sessionId: s0,
    grandTotal: 42_000,
    amountPaid: 42_000,
    issuedAt: "2026-02-25T06:50:00Z",
  });
  await insertPayment(c, ref, {
    billId: bill1,
    method: "CASH",
    amount: 30_000,
    createdAt: "2026-03-02T07:35:00Z",
  });
  await insertPayment(c, ref, {
    billId: bill1,
    method: "UPI",
    amount: 22_500,
    createdAt: "2026-03-02T07:36:00Z",
  });
  await insertPayment(c, ref, {
    billId: bill2,
    method: "CARD",
    amount: 20_000,
    createdAt: "2026-03-03T08:05:00Z",
  });
  await insertPayment(c, ref, {
    billId: bill2,
    method: "CARD",
    amount: 5_000,
    status: "VOIDED",
    createdAt: "2026-03-03T08:06:00Z",
  });
  await insertPayment(c, ref, {
    billId: bill1,
    method: "CASH",
    amount: 2_500,
    kind: "REFUND",
    createdAt: "2026-03-04T10:00:00Z",
  });
  await insertPayment(c, ref, {
    billId: bill0,
    method: "UPI",
    amount: 42_000,
    createdAt: "2026-02-25T06:55:00Z",
  });
}

async function seedSimpleBranch(ref: BranchRefs, amount: number) {
  const t = await insertTable(c, ref, "A1");
  const s = await insertSession(c, ref, {
    tableId: t,
    openedAt: "2026-03-03T09:30:00Z",
    closedAt: "2026-03-03T11:00:00Z",
  });
  await insertOrder(c, ref, {
    tableId: t,
    sessionId: s,
    status: "COMPLETED",
    createdAt: "2026-03-03T10:00:00Z",
    acceptedAfter: 2,
    readyAfter: 10,
    lines: [{ name: "Thali", category: "Mains", quantity: 1, unitPrice: amount }],
  });
  const bill = await insertBill(c, ref, {
    tableId: t,
    sessionId: s,
    grandTotal: amount,
    amountPaid: amount,
    issuedAt: "2026-03-03T10:30:00Z",
  });
  await insertPayment(c, ref, {
    billId: bill,
    method: "CASH",
    amount,
    createdAt: "2026-03-03T10:40:00Z",
  });
}

beforeAll(async () => {
  c = await createTestContainer();
  ownerA = await signUpUser("Owner A");
  ownerB = await signUpUser("Owner B");
  manager = await signUpUser("Manager");
  waiter = await signUpUser("Waiter");
  cook = await signUpUser("Cook");
  wsA = (await createWorkspaceAs(ownerA, "Workspace A")).id;
  wsB = (await createWorkspaceAs(ownerB, "Workspace B")).id;

  const a = await insertRestaurantWithBranch(c, wsA, { name: "Spice Garden" });
  b1 = { workspaceId: wsA, restaurantId: a.restaurantId, branchId: a.branchId };
  b2 = {
    workspaceId: wsA,
    restaurantId: a.restaurantId,
    branchId: await insertBranch(c, {
      workspaceId: wsA,
      restaurantId: a.restaurantId,
      name: "Second",
    }),
  };
  const x = await insertRestaurantWithBranch(c, wsB, { name: "Other Place" });
  bx = { workspaceId: wsB, restaurantId: x.restaurantId, branchId: x.branchId };

  await seedBranch1(b1);
  await seedSimpleBranch(b2, 10_500);
  await seedSimpleBranch(bx, 777_700);

  await addStaffMember(c, {
    workspaceId: wsA,
    userId: manager.userId,
    role: "restaurant_manager",
    restaurantId: b2.restaurantId,
    branchId: b2.branchId,
  });
  await addStaffMember(c, {
    workspaceId: wsA,
    userId: waiter.userId,
    role: "waiter",
    restaurantId: b1.restaurantId,
    branchId: b1.branchId,
  });
  await addStaffMember(c, {
    workspaceId: wsA,
    userId: cook.userId,
    role: "kitchen_staff",
    restaurantId: b1.restaurantId,
    branchId: b1.branchId,
  });
});

afterAll(async () => {
  await c.close();
});

describe("branch analytics", () => {
  it("computes sales KPIs, deltas and daily series in the branch time zone", async () => {
    const res = await getBranch(ownerA, b1.branchId);
    expect(res.status).toBe(200);
    const d = res.body.data!;
    expect(d.range).toMatchObject({
      from: "2026-03-01",
      to: "2026-03-07",
      days: 7,
      previousFrom: "2026-02-22",
      previousTo: "2026-02-28",
      timezone: "Asia/Kolkata",
    });
    expect(d.kpis).toEqual({
      totalOrders: 5,
      validOrders: 3,
      completedOrders: 2,
      cancelledOrders: 2,
      orderValue: 105_000,
      averageOrderValue: 35_000,
      billed: 84_000,
      billCount: 2,
      collected: 70_000,
      pendingNow: 2,
    });
    expect(d.previous).toMatchObject({
      totalOrders: 1,
      orderValue: 40_000,
      billed: 42_000,
      collected: 42_000,
    });
    expect(d.deltas.orderValue).toBe(162.5);
    expect(d.deltas.collected).toBe(66.7);
    expect(d.deltas.cancelledOrders).toBeNull();

    expect(d.daily).toHaveLength(7);
    expect(d.daily.find((p) => p.date === "2026-03-02")).toEqual({
      date: "2026-03-02",
      orders: 1,
      validOrders: 1,
      orderValue: 50_000,
      billed: 52_500,
      collected: 52_500,
    });
    expect(d.daily.find((p) => p.date === "2026-03-04")?.collected).toBe(-2_500);
    // The 23:30 IST order lands on the 7th, the 00:30 IST one does not appear at all.
    expect(d.daily.find((p) => p.date === "2026-03-07")).toMatchObject({
      orders: 1,
      orderValue: 25_000,
    });
    expect(d.daily.find((p) => p.date === "2026-03-06")?.orders).toBe(0);
  });

  it("buckets peak hours by local weekday and hour", async () => {
    const d = (await getBranch(ownerA, b1.branchId)).body.data!;
    expect(d.peakHours).toContainEqual({ weekday: 6, hour: 23, orders: 1 });
    expect(d.peakHours).toContainEqual({ weekday: 1, hour: 12, orders: 1 });
    expect(d.peakHours.reduce((s, c) => s + c.orders, 0)).toBe(5);
  });

  it("ranks items and categories from order snapshots of valid orders", async () => {
    const d = (await getBranch(ownerA, b1.branchId)).body.data!;
    expect(d.topItems).toEqual([
      { name: "Paneer Tikka", category: "Starters", quantity: 3, revenue: 45_000, orders: 2 },
      { name: "Lassi", category: "Drinks", quantity: 3, revenue: 30_000, orders: 2 },
      { name: "Dal Makhani", category: "Mains", quantity: 2, revenue: 30_000, orders: 2 },
    ]);
    expect(d.categories).toEqual([
      { category: "Starters", quantity: 3, revenue: 45_000, items: 1 },
      { category: "Drinks", quantity: 3, revenue: 30_000, items: 1 },
      { category: "Mains", quantity: 2, revenue: 30_000, items: 1 },
    ]);
  });

  it("reports payment methods and cashier metrics", async () => {
    const d = (await getBranch(ownerA, b1.branchId)).body.data!;
    expect(d.paymentMethods).toEqual([
      {
        method: "CASH",
        payments: 30_000,
        paymentCount: 1,
        refunds: 2_500,
        refundCount: 1,
        net: 27_500,
      },
      { method: "UPI", payments: 22_500, paymentCount: 1, refunds: 0, refundCount: 0, net: 22_500 },
      {
        method: "CARD",
        payments: 20_000,
        paymentCount: 1,
        refunds: 0,
        refundCount: 0,
        net: 20_000,
      },
    ]);
    expect(d.cashier).toMatchObject({
      totalCollections: 70_000,
      paymentCount: 3,
      outstandingBalance: 11_500,
      unpaidBills: 0,
      partiallyPaidBills: 1,
      refundsTotal: 2_500,
      refundCount: 1,
      voidedPayments: 1,
      discountsTotal: 1_000,
    });
  });

  it("computes kitchen timings and delayed orders", async () => {
    const d = (await getBranch(ownerA, b1.branchId)).body.data!;
    expect(d.kitchen).toMatchObject({
      avgPrepMinutes: 25,
      avgWaitMinutes: 7.5,
      delayedOrders: 1,
      ordersCompleted: 2,
      ordersAccepted: 2,
      delayThresholdMinutes: 20,
    });
    expect(d.kitchen.items).toEqual([
      { name: "Paneer Tikka", orders: 2, quantity: 3, avgPrepMinutes: 25 },
      { name: "Dal Makhani", orders: 1, quantity: 1, avgPrepMinutes: 30 },
      { name: "Lassi", orders: 1, quantity: 2, avgPrepMinutes: 20 },
    ]);
  });

  it("computes table utilization against default business hours", async () => {
    const d = (await getBranch(ownerA, b1.branchId)).body.data!;
    expect(d.tables.totalSessions).toBe(3);
    expect(d.tables.avgSessionMinutes).toBe(80);
    expect(d.tables.openMinutes).toBe(7 * 720);
    expect(d.tables.occupancyPercent).toBe(2.4);
    const t1 = d.tables.tables.find((t) => t.name === "T1")!;
    expect(t1).toMatchObject({ sessions: 2, avgSessionMinutes: 80, occupiedMinutes: 160 });
    expect(t1.occupancyPercent).toBe(3.2);
  });

  it("defaults to the last 7 days and validates ranges", async () => {
    const def = await getBranch(ownerA, b1.branchId, "");
    expect(def.status).toBe(200);
    expect(def.body.data!.range.days).toBe(7);

    const reversed = await getBranch(ownerA, b1.branchId, "from=2026-03-07&to=2026-03-01");
    expect(reversed.status).toBe(422);
    expect(reversed.body.error?.fieldErrors?.from).toBeDefined();
    const tooLong = await getBranch(ownerA, b1.branchId, "from=2025-01-01&to=2026-03-01");
    expect(tooLong.status).toBe(422);
    const bad = await getBranch(ownerA, b1.branchId, "from=2026-02-31");
    expect(bad.status).toBe(422);
  });

  it("denies waiters (no reports.view) and other tenants", async () => {
    expect((await getBranch(waiter, b1.branchId)).status).toBe(403);
    expect((await getBranch(cook, b1.branchId)).status).toBe(403);
    expect((await getBranch(ownerB, b1.branchId)).status).toBe(404);
    expect((await getBranch(ownerA, bx.branchId)).status).toBe(404);
    expect((await getBranch(manager, b1.branchId)).status).toBe(404);
  });

  it("lets a branch-assigned manager read that branch's reports", async () => {
    const res = await getBranch(manager, b2.branchId);
    expect(res.status).toBe(200);
    expect(res.body.data!.kpis).toMatchObject({ totalOrders: 1, collected: 10_500 });
  });
});

describe("branch live snapshot", () => {
  const live = (user: TestUser, branchId: string) =>
    call<BranchLiveDto>(branchLive, { cookie: user.cookie, params: { branchId } });

  it("returns live counts with sections gated by permission", async () => {
    const owner = await live(ownerA, b1.branchId);
    expect(owner.status).toBe(200);
    expect(owner.body.data!.orders).toMatchObject({ pending: 2, inKitchen: 0, ready: 0 });
    expect(owner.body.data!.tables).toEqual({ active: 0, total: 2, billRequested: 0 });
    expect(owner.body.data!.bills).toMatchObject({ open: 1, outstanding: 11_500 });

    const w = (await live(waiter, b1.branchId)).body.data!;
    expect(w.orders).not.toBeNull();
    expect(w.tables).not.toBeNull();

    const k = (await live(cook, b1.branchId)).body.data!;
    expect(k.orders).not.toBeNull();
    expect(k.tables).toBeNull();
    expect(k.bills).toBeNull();

    expect((await live(ownerB, b1.branchId)).status).toBe(404);
  });
});

describe("workspace analytics", () => {
  it("consolidates all branches for the owner with branch comparison", async () => {
    const res = await getWorkspace(ownerA, wsA);
    expect(res.status).toBe(200);
    const d = res.body.data!;
    expect(d.branchIds.sort()).toEqual([b1.branchId, b2.branchId].sort());
    expect(d.kpis).toMatchObject({
      totalOrders: 6,
      validOrders: 4,
      orderValue: 115_500,
      billed: 94_500,
      collected: 80_500,
      pendingNow: 2,
    });
    expect(d.restaurants).toEqual([
      expect.objectContaining({ restaurantId: b1.restaurantId, branches: 2, collected: 80_500 }),
    ]);
    expect(d.branchComparison.available).toBe(true);
    if (d.branchComparison.available) {
      const rows = Object.fromEntries(d.branchComparison.data.map((r) => [r.branchId, r]));
      expect(rows[b1.branchId]).toMatchObject({ collected: 70_000, previousCollected: 42_000 });
      expect(rows[b2.branchId]).toMatchObject({
        collected: 10_500,
        orders: 1,
        avgPrepMinutes: 10,
      });
    }
    // Workspace B's numbers never appear in A.
    expect(JSON.stringify(d)).not.toContain("777700");
  });

  it("applies restaurant and branch filters inside the workspace only", async () => {
    const one = await getWorkspace(ownerA, wsA, `${RANGE}&branchId=${b2.branchId}`);
    expect(one.status).toBe(200);
    expect(one.body.data!.kpis.collected).toBe(10_500);
    const byRestaurant = await getWorkspace(
      ownerA,
      wsA,
      `${RANGE}&restaurantId=${b1.restaurantId}`,
    );
    expect(byRestaurant.body.data!.kpis.collected).toBe(80_500);

    expect((await getWorkspace(ownerA, wsA, `${RANGE}&branchId=${bx.branchId}`)).status).toBe(404);
    expect(
      (await getWorkspace(ownerA, wsA, `${RANGE}&restaurantId=${bx.restaurantId}`)).status,
    ).toBe(404);
    expect((await getWorkspace(ownerA, wsA, `${RANGE}&branchId=not-a-uuid`)).status).toBe(422);
  });

  it("isolates tenants", async () => {
    const res = await getWorkspace(ownerB, wsB);
    expect(res.status).toBe(200);
    expect(res.body.data!.kpis).toMatchObject({ totalOrders: 1, collected: 777_700 });
    expect(res.body.data!.branchIds).toEqual([bx.branchId]);
    expect((await getWorkspace(ownerB, wsA)).status).toBe(404);
  });

  it("limits a branch-assigned manager to that branch", async () => {
    const res = await getWorkspace(manager, wsA);
    expect(res.status).toBe(200);
    expect(res.body.data!.branchIds).toEqual([b2.branchId]);
    expect(res.body.data!.kpis).toMatchObject({ totalOrders: 1, collected: 10_500 });
    expect((await getWorkspace(manager, wsA, `${RANGE}&branchId=${b1.branchId}`)).status).toBe(404);
  });

  it("forbids staff without reporting permissions", async () => {
    expect((await getWorkspace(waiter, wsA)).status).toBe(403);
  });

  it("returns the report without branch comparison when advanced analytics is not in the plan", async () => {
    const [starter] = await c.db
      .select({ id: subscriptionPlans.id })
      .from(subscriptionPlans)
      .where(eq(subscriptionPlans.key, "starter"));
    await c.db
      .update(subscriptions)
      .set({ planId: starter!.id })
      .where(and(eq(subscriptions.workspaceId, wsB), eq(subscriptions.isCurrent, true)));
    const res = await getWorkspace(ownerB, wsB);
    expect(res.status).toBe(200);
    expect(res.body.data!.kpis.collected).toBe(777_700);
    expect(res.body.data!.branchComparison).toMatchObject({
      available: false,
      error: { code: "ENTITLEMENT_REQUIRED", feature: "advanced_analytics" },
    });
  });

  it("requires the analytics feature", async () => {
    await c.db
      .update(subscriptionPlans)
      .set({ features: [] })
      .where(eq(subscriptionPlans.key, "starter"));
    try {
      const res = await getWorkspace(ownerB, wsB);
      expect(res.status).toBe(402);
      expect(res.body.error?.code).toBe("ENTITLEMENT_REQUIRED");
    } finally {
      await c.db
        .update(subscriptionPlans)
        .set({
          features: [
            "qr_ordering",
            "kitchen_display",
            "analytics",
            "offline_mode",
            "email_notifications",
          ],
        })
        .where(eq(subscriptionPlans.key, "starter"));
    }
  });
});

describe("admin analytics", () => {
  it("is limited to Super Admins", async () => {
    const res = await call(adminAnalytics, { cookie: ownerA.cookie });
    expect(res.status).toBe(403);
    expect((await call(adminAnalytics, {})).status).toBe(401);
  });

  it("returns platform aggregates", async () => {
    const admin = await signUpUser("Platform Admin");
    await makePlatformAdmin(c, admin.userId);

    // Workspace A converts from trial to paid.
    await c.db.insert(subscriptionEvents).values({
      workspaceId: wsA,
      type: "activated",
      fromStatus: "TRIALING",
      toStatus: "ACTIVE",
      planKey: "pro",
    });

    const res = await call<AdminAnalyticsDto>(adminAnalytics, { cookie: admin.cookie });
    expect(res.status).toBe(200);
    const d = res.body.data!;
    expect(d.totals).toMatchObject({
      workspaces: 2,
      activeWorkspaces: 2,
      trialWorkspaces: 2,
      paidWorkspaces: 0,
      suspendedWorkspaces: 0,
      restaurants: 2,
      branches: 3,
      users: 6,
    });
    expect(d.recentWorkspaces.map((w) => w.id).sort()).toEqual([wsA, wsB].sort());
    expect(d.recentWorkspaces[0]).toMatchObject({ phase: "TRIAL" });
    expect(d.phaseDistribution).toEqual([{ phase: "TRIAL", count: 2 }]);
    expect(d.planDistribution.map((p) => p.planKey).sort()).toEqual(["pro", "starter"]);
    expect(d.trialConversion).toEqual({ trialsStarted: 2, converted: 1, rate: 50 });
    expect(d.workspaceGrowth).toHaveLength(12);
    expect(d.workspaceGrowth.at(-1)!.cumulative).toBe(2);
    expect(d.usage.ordersPerDay).toHaveLength(30);
    // Seeded orders are from March; none in the last 30 days.
    expect(d.usage.ordersLast30Days).toBe(0);
    // No tenant records beyond aggregates in the usage section.
    expect(Object.keys(d.usage.ordersPerDay[0]!)).toEqual(["date", "orders"]);
  });
});
