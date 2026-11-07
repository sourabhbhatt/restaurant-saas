import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createOfflineDb, OFFLINE_DB_NAME, type OfflineDatabase, type OutboxItem } from "./db";
import {
  kitchenItemStatusMutation,
  kitchenTransitionMutation,
  queuedKitchenState,
  queuedStaffOrders,
  staffOrderMutation,
} from "./queued-ops";
import { canRetryWithLatest, SyncEngine } from "./sync-engine";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: Record<string, unknown> | undefined;
}

type Responder = (call: Call) => Response | "network-error";

const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
const apiError = (status: number, code: string, details?: unknown) =>
  json(status, { error: { code, message: code, requestId: "r", details } });

const BRANCH = "branch-1";
const ORDER = { id: "order-1", orderNumber: 12, version: 4 };
const ITEM = { id: "item-1", itemName: "Masala Chai", quantity: 2 };
const ITEM_2 = { id: "item-2", itemName: "Butter Naan", quantity: 1 };

let db: OfflineDatabase;
let now: number;
let calls: Call[];
let responder: Responder;
let engine: SyncEngine;
let ids = 0;

function makeEngine(target: OfflineDatabase = db) {
  return new SyncEngine({
    db: target,
    getUserId: () => "user-1",
    now: () => now,
    random: () => 0.5,
    newId: () => `item-${++ids}`,
    fetch: async (url, init) => {
      const call: Call = {
        url,
        method: String(init.method),
        headers: init.headers as Record<string, string>,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const res = responder(call);
      if (res === "network-error") throw new TypeError("Failed to fetch");
      return res;
    },
  });
}

const orderResponse = (version: number, status = "PREPARING") =>
  json(200, { data: { id: ORDER.id, version, status, subtotal: 15800 } });

beforeEach(() => {
  db = createOfflineDb(`queued-${crypto.randomUUID()}`);
  now = 2_000_000;
  calls = [];
  responder = () => orderResponse(ORDER.version);
  engine = makeEngine();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe("queued kitchen operations", () => {
  it("queued kitchen status uses expectedVersion and maps 409 to conflict", async () => {
    const item = await engine.enqueue(
      kitchenItemStatusMutation({ branchId: BRANCH, order: ORDER, item: ITEM, status: "READY" }),
    );
    expect(item.scopeKey).toBe(`order:${ORDER.id}`);

    responder = () => apiError(409, "INVALID_STATE_TRANSITION");
    const result = await engine.syncNow();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.url).toBe(`/api/v1/orders/${ORDER.id}/items/${ITEM.id}`);
    // The API's field name, not the generic `version`.
    expect(calls[0]!.body).toEqual({ status: "READY", expectedVersion: ORDER.version });
    expect(result.conflicts).toBe(1);
    expect((await db.outbox.get(item.id))!.status).toBe("conflict");

    const transition = await engine.enqueue(
      kitchenTransitionMutation({ branchId: BRANCH, order: ORDER, action: "ready" }),
    );
    responder = () => apiError(409, "STALE_VERSION", { status: "READY", version: 6 });
    // Same scope: blocked behind the conflicting head until the user acts.
    await engine.syncNow({ force: true });
    expect(calls).toHaveLength(1);
    await engine.discard(item.id);
    await engine.syncNow();
    expect(calls[1]!.url).toBe(`/api/v1/orders/${ORDER.id}/transition`);
    expect(calls[1]!.body).toEqual({ action: "ready", expectedVersion: ORDER.version });
    expect((await db.outbox.get(transition.id))!.status).toBe("conflict");
  });

  it("rebases later changes of the same order on the version the server returned", async () => {
    const first = await engine.enqueue(
      kitchenItemStatusMutation({
        branchId: BRANCH,
        order: ORDER,
        item: ITEM,
        status: "PREPARING",
      }),
    );
    const second = await engine.enqueue(
      kitchenItemStatusMutation({ branchId: BRANCH, order: ORDER, item: ITEM, status: "READY" }),
    );
    // Starting the first item also starts the order (version 4 → 5).
    responder = (call) =>
      call.body?.status === "PREPARING" ? orderResponse(5) : orderResponse(6, "READY");
    await engine.syncNow();
    expect(calls.map((c) => c.body?.expectedVersion)).toEqual([4, 5]);
    expect((await db.outbox.get(first.id))!.status).toBe("synced");
    expect((await db.outbox.get(second.id))!.status).toBe("synced");
  });

  it("does not rebase changes of other orders", async () => {
    await engine.enqueue(
      kitchenItemStatusMutation({
        branchId: BRANCH,
        order: ORDER,
        item: ITEM,
        status: "PREPARING",
      }),
    );
    const other = await engine.enqueue(
      kitchenItemStatusMutation({
        branchId: BRANCH,
        order: { ...ORDER, id: "order-2" },
        item: ITEM_2,
        status: "PREPARING",
      }),
    );
    responder = (call) =>
      call.url.includes(ORDER.id) ? orderResponse(9) : orderResponse(ORDER.version);
    await engine.syncNow();
    const sent = calls.find((c) => c.url.includes("order-2"))!;
    expect(sent.body?.expectedVersion).toBe(ORDER.version);
    expect((await db.outbox.get(other.id))!.expectedVersion).toBe(ORDER.version);
  });

  it("retry with latest resends a transition against the server's current version", async () => {
    const item = await engine.enqueue(
      kitchenTransitionMutation({ branchId: BRANCH, order: ORDER, action: "ready" }),
    );
    responder = () => apiError(409, "STALE_VERSION", { status: "PREPARING", version: 7 });
    await engine.syncNow();
    responder = () => orderResponse(8, "READY");
    expect(await engine.retryWithLatest(item.id)).toBe(true);
    await engine.syncNow();
    expect(calls[1]!.body).toEqual({ action: "ready", expectedVersion: 7 });
    expect((await db.outbox.get(item.id))!.status).toBe("synced");
  });

  it("refuses retry with latest when a chained conflict reports no version", async () => {
    const item = await engine.enqueue(
      kitchenTransitionMutation({ branchId: BRANCH, order: ORDER, action: "ready" }),
    );
    // e.g. the order was cancelled meanwhile: no version to resend against.
    responder = () => apiError(409, "INVALID_STATE_TRANSITION");
    await engine.syncNow();
    const stored = (await db.outbox.get(item.id))!;
    expect(stored.status).toBe("conflict");
    expect(canRetryWithLatest(stored)).toBe(false);
    expect(await engine.retryWithLatest(item.id)).toBe(false);
    await engine.syncNow({ force: true });
    expect(calls).toHaveLength(1);
    expect((await db.outbox.get(item.id))!.status).toBe("conflict");
    // Discard stays available.
    expect(await engine.discard(item.id)).toBe(true);
  });

  it("allows retry with latest for unchained conflicts and versioned chained ones", async () => {
    const menu = await engine.enqueue({
      kind: "menu.edit",
      label: "Rename Dal",
      method: "PATCH",
      path: "/menu-items/1",
      body: { name: "Dal" },
      scopeKey: "menuItem:1",
      expectedVersion: 2,
    });
    const chained = await engine.enqueue(
      kitchenTransitionMutation({ branchId: BRANCH, order: ORDER, action: "ready" }),
    );
    responder = (call) =>
      call.url.includes("menu-items")
        ? apiError(409, "STALE_VERSION")
        : apiError(409, "STALE_VERSION", { status: "PREPARING", version: 9 });
    await engine.syncNow();
    expect(canRetryWithLatest((await db.outbox.get(menu.id))!)).toBe(true);
    expect(canRetryWithLatest((await db.outbox.get(chained.id))!)).toBe(true);
  });

  it("derives the queued item and order state for the ticket", async () => {
    await engine.enqueue(
      kitchenItemStatusMutation({
        branchId: BRANCH,
        order: ORDER,
        item: ITEM,
        status: "PREPARING",
      }),
    );
    await engine.enqueue(
      kitchenItemStatusMutation({ branchId: BRANCH, order: ORDER, item: ITEM, status: "READY" }),
    );
    await engine.enqueue(
      kitchenTransitionMutation({ branchId: BRANCH, order: ORDER, action: "start" }),
    );
    const items = await db.outbox.toArray();
    const state = queuedKitchenState(items, ORDER.id);
    expect(state.itemStatus).toEqual({ [ITEM.id]: "READY" });
    expect(state.actions).toEqual(["start"]);
    expect(state.waiting).toBe(true);
    expect(state.needsAttention).toBe(false);
    expect(queuedKitchenState(items, "order-2").waiting).toBe(false);
  });
});

const orderBody = (idempotencyKey = "draftKey_0001") => ({
  tableId: "table-5",
  priority: "NORMAL" as const,
  idempotencyKey,
  specialInstructions: "e2e",
  lines: [{ menuItemId: "menu-1", addonIds: [], quantity: 2 }],
});

describe("queued staff orders", () => {
  it("staff order retry reuses the same idempotencyKey", async () => {
    const queued = await engine.enqueue(
      staffOrderMutation({ branchId: BRANCH, tableName: "T5", body: orderBody() }),
    );
    expect(queued.scopeKey).toBe("table:table-5");
    expect(queued.idempotencyKey).toBe("draftKey_0001");

    const replies: Responder[] = [
      () => "network-error",
      () => apiError(503, "INTERNAL_ERROR"),
      () => json(201, { data: { id: "o-1", orderNumber: 3, subtotal: 15800 } }),
    ];
    for (const reply of replies) {
      responder = reply;
      await engine.syncNow({ force: true });
    }
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.method).toBe("POST");
      expect(call.url).toBe(`/api/v1/branches/${BRANCH}/orders`);
      expect(call.body?.idempotencyKey).toBe("draftKey_0001");
      expect(call.headers["idempotency-key"]).toBe("draftKey_0001");
    }
    expect((await db.outbox.get(queued.id))!.status).toBe("synced");
  });

  it("offline staff order is never marked synced without 2xx", async () => {
    const queued = await engine.enqueue(
      staffOrderMutation({ branchId: BRANCH, tableName: "T5", body: orderBody() }),
    );
    const notSynced: Responder[] = [
      () => "network-error",
      () => apiError(500, "INTERNAL_ERROR"),
      () => apiError(429, "RATE_LIMITED"),
      () => apiError(401, "UNAUTHENTICATED"),
    ];
    for (const reply of notSynced) {
      responder = reply;
      await engine.syncNow({ force: true });
      const stored = (await db.outbox.get(queued.id))!;
      expect(stored.status).toBe("pending");
      expect(stored.syncedAt).toBeNull();
    }
    responder = () => apiError(422, "VALIDATION_FAILED");
    await engine.syncNow({ force: true });
    expect((await db.outbox.get(queued.id))!.status).toBe("failed");

    // A replay (200) of an order the server already created settles it,
    // and the totals shown afterwards are the server's.
    await engine.retry(queued.id);
    responder = () => json(200, { data: { id: "o-1", orderNumber: 3, subtotal: 15800 } });
    await engine.syncNow();
    const stored = (await db.outbox.get(queued.id))!;
    expect(stored.status).toBe("synced");
    expect(stored.serverResponse).toEqual({ id: "o-1", orderNumber: 3, subtotal: 15800 });
    expect(new Set(calls.map((c) => c.body?.idempotencyKey))).toEqual(new Set(["draftKey_0001"]));
  });

  it("lists unsent orders for a table", async () => {
    const a = await engine.enqueue(
      staffOrderMutation({ branchId: BRANCH, tableName: "T5", body: orderBody("draftKey_000A") }),
    );
    await engine.enqueue(
      staffOrderMutation({
        branchId: BRANCH,
        tableName: "T6",
        body: { ...orderBody("draftKey_000B"), tableId: "table-6" },
      }),
    );
    const items = await db.outbox.toArray();
    expect(queuedStaffOrders(items, "table-5").map((i) => i.id)).toEqual([a.id]);
    await db.outbox.update(a.id, { status: "synced" });
    expect(queuedStaffOrders(await db.outbox.toArray(), "table-5")).toEqual([]);
  });
});

describe("local database upgrade", () => {
  it("opening a database created with the original v1 schema keeps and syncs its pending items", async () => {
    const name = `${OFFLINE_DB_NAME}-upgrade-${crypto.randomUUID()}`;
    // The schema exactly as the first release shipped it.
    const v1 = new Dexie(name);
    v1.version(1).stores({
      queryCache: "key, userId, updatedAt",
      outbox: "id, userId, status, scopeKey, createdAt, [userId+status]",
      drafts: "key, userId, updatedAt",
      meta: "key",
    });
    const legacy: OutboxItem = {
      id: "legacy-1",
      createdAt: now,
      updatedAt: now,
      userId: "user-1",
      scopeKey: "branch:a",
      kind: "menu.availability",
      label: "Mark Paneer Tikka unavailable",
      method: "PATCH",
      path: "/menu-items/1/availability",
      body: { isAvailable: false },
      idempotencyKey: "legacyKey_001",
      expectedVersion: 3,
      status: "pending",
      attempts: 2,
      nextAttemptAt: now,
      lastError: "No connection to the server",
      lastErrorCode: "NETWORK_ERROR",
      lastStatus: 0,
      syncedAt: null,
    };
    await v1
      .table("outbox")
      .bulkAdd([legacy, { ...legacy, id: "legacy-2", status: "conflict", createdAt: now + 1 }]);
    v1.close();

    const upgraded = createOfflineDb(name);
    try {
      await upgraded.open();
      expect(upgraded.verno).toBeGreaterThanOrEqual(1);
      expect((await upgraded.outbox.toArray()).map((i) => [i.id, i.status])).toEqual([
        ["legacy-1", "pending"],
        ["legacy-2", "conflict"],
      ]);
      // A row written by the old release still syncs the old way (body.version).
      responder = () => json(200, { data: { ok: true } });
      await makeEngine(upgraded).syncNow();
      expect(calls[0]!.body).toEqual({ isAvailable: false, version: 3 });
      expect(calls[0]!.headers["idempotency-key"]).toBe("legacyKey_001");
      expect((await upgraded.outbox.get("legacy-1"))!.status).toBe("synced");
    } finally {
      upgraded.close();
      await upgraded.delete();
    }
  });
});
