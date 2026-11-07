import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as branchEvents } from "@/app/api/v1/branches/[branchId]/events/route";
import { GET as kitchenFeed } from "@/app/api/v1/branches/[branchId]/kitchen/route";
import { PATCH as patchItem } from "@/app/api/v1/orders/[orderId]/items/[itemId]/route";
import { GET as publicPlans } from "@/app/api/v1/public/plans/route";
import type { PublicPlanDto } from "@ros/contracts/platform";
import { ADVERTISED_FEATURES } from "@ros/domain/subscriptions/entitlements";
import { workspaceEntitlements } from "@ros/database/providers/postgres/schema";
import type { Container } from "@/composition/container";
import type { TestUser } from "@/test/fixtures";
import {
  addStaff,
  insertMenuItem,
  insertOrder,
  insertTable,
  openSession,
  setupBranch,
  type TestBranch,
} from "@/test/fixtures-staff-ops";
import { call, createTestContainer, TEST_ORIGIN } from "@/test/harness";

let c: Container;

beforeAll(async () => {
  c = await createTestContainer();
});
afterAll(async () => {
  await c.close();
});

async function kitchenSetup(name: string, withFeature: boolean) {
  const branch: TestBranch = await setupBranch(c, { workspaceName: name });
  const kitchen = await addStaff(c, branch, "kitchen_staff", "Cook");
  const waiter = await addStaff(c, branch, "waiter", "Waiter");
  if (!withFeature) {
    await c.db.insert(workspaceEntitlements).values({
      workspaceId: branch.workspaceId,
      key: "feature:kitchen_display",
      value: false,
    });
  }
  const tableId = await insertTable(c, branch, "T1");
  const sessionId = await openSession(c, branch, tableId);
  const menuItemId = await insertMenuItem(c, branch, "Burger", { prepTimeMinutes: 10 });
  const order = await insertOrder(c, branch, {
    tableId,
    sessionId,
    status: "ACCEPTED",
    acceptedAt: new Date(),
    lines: [{ name: "Burger", menuItemId }],
  });
  return { branch, kitchen, waiter, order };
}

function openStream(branch: TestBranch, user: TestUser) {
  const controller = new AbortController();
  const req = new Request(`${TEST_ORIGIN}/api/v1/branches/${branch.branchId}/events`, {
    headers: { cookie: user.cookie },
    signal: controller.signal,
  });
  return branchEvents(req, { params: Promise.resolve({ branchId: branch.branchId }) }).then(
    (res) => ({ res, controller }),
  );
}

describe("kitchen_display enforcement", () => {
  it("plan without kitchen_display gets 402 ENTITLEMENT_REQUIRED on kitchen feed, item status and kitchen-only event stream", async () => {
    const { branch, kitchen, order } = await kitchenSetup("No KDS WS", false);

    const feed = await call(kitchenFeed, {
      params: { branchId: branch.branchId },
      cookie: kitchen.cookie,
    });
    expect(feed.status).toBe(402);
    expect(feed.body.error?.code).toBe("ENTITLEMENT_REQUIRED");

    const item = await call(patchItem, {
      method: "PATCH",
      params: { orderId: order.orderId, itemId: order.itemIds[0]! },
      body: { status: "PREPARING" },
      cookie: kitchen.cookie,
    });
    expect(item.status).toBe(402);
    expect(item.body.error?.code).toBe("ENTITLEMENT_REQUIRED");

    const { res, controller } = await openStream(branch, kitchen);
    controller.abort();
    expect(res.status).toBe(402);
  });

  it("plan with it gets 200", async () => {
    const { branch, kitchen, order } = await kitchenSetup("KDS WS", true);
    const feed = await call(kitchenFeed, {
      params: { branchId: branch.branchId },
      cookie: kitchen.cookie,
    });
    expect(feed.status).toBe(200);
    const item = await call(patchItem, {
      method: "PATCH",
      params: { orderId: order.orderId, itemId: order.itemIds[0]! },
      body: { status: "PREPARING" },
      cookie: kitchen.cookie,
    });
    expect(item.status).toBe(200);
    const { res, controller } = await openStream(branch, kitchen);
    controller.abort();
    expect(res.status).toBe(200);
  });

  it("waiter event stream (orders.view) is unaffected", async () => {
    const { branch, waiter } = await kitchenSetup("No KDS Waiter WS", false);
    const { res, controller } = await openStream(branch, waiter);
    controller.abort();
    expect(res.status).toBe(200);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("feature catalogue truth", () => {
  it("every advertised feature has an enforcement call site", () => {
    // Enforcement lives in the application package and the API composition root.
    const source = [
      ...sourceFiles(join(import.meta.dirname, "../../../../packages/application/src")),
      ...sourceFiles(join(import.meta.dirname, "../../src/composition")),
    ]
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    for (const key of ADVERTISED_FEATURES) {
      const pattern = new RegExp(
        `(assertFeature\\([^)]*["']${key}["']|features\\.includes\\(\\s*["']${key}["'])`,
      );
      expect(source, key).toMatch(pattern);
    }
  });

  it("pricing API lists only advertised features", async () => {
    const res = await call<PublicPlanDto[]>(publicPlans, {});
    expect(res.status).toBe(200);
    const keys = res.body.data!.flatMap((p) => p.features.map((f) => f.key));
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(ADVERTISED_FEATURES).toContain(k);
  });
});
