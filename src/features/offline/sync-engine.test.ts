import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createOfflineDb, switchUser, type OfflineDatabase } from "./db";
import {
  BACKOFF_MAX_MS,
  STUCK_SYNCING_MS,
  SyncEngine,
  backoffDelay,
  classifyResponse,
  type EnqueueInput,
} from "./sync-engine";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Responder = (call: Call) => Response | Promise<Response> | "network-error";

function json(status: number, payload: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const ok = (data: unknown = { ok: true }) => json(200, { data });
const apiError = (status: number, code: string, message = code) =>
  json(status, { error: { code, message, requestId: "r" } });

let db: OfflineDatabase;
let now: number;
let calls: Call[];
let responder: Responder;
let userId: string | null;
let engine: SyncEngine;
let ids = 0;

function makeEngine() {
  return new SyncEngine({
    db,
    getUserId: () => userId,
    now: () => now,
    random: () => 0.5, // no jitter: 0.8 + 0.4 * 0.5 = 1
    newId: () => `item-${++ids}`,
    fetch: async (url, init) => {
      const call: Call = {
        url,
        method: String(init.method),
        headers: init.headers as Record<string, string>,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      const res = await responder(call);
      if (res === "network-error") throw new TypeError("Failed to fetch");
      return res;
    },
  });
}

const input = (overrides: Partial<EnqueueInput> = {}): EnqueueInput => ({
  kind: "menu.availability",
  label: "Mark Paneer Tikka unavailable",
  method: "PATCH",
  path: "/menu-items/1/availability",
  body: { isAvailable: false },
  scopeKey: "branch:a",
  ...overrides,
});

beforeEach(() => {
  db = createOfflineDb(`test-${crypto.randomUUID()}`);
  now = 1_000_000;
  calls = [];
  userId = "user-1";
  responder = () => ok();
  engine = makeEngine();
});

afterEach(async () => {
  db.close();
  await db.delete();
});

describe("backoff", () => {
  it("doubles from 1s and caps at 5 minutes", () => {
    const schedule = [1, 2, 3, 4, 5, 9, 10, 20].map((n) => backoffDelay(n, () => 0.5));
    expect(schedule).toEqual([
      1000,
      2000,
      4000,
      8000,
      16000,
      256000,
      BACKOFF_MAX_MS,
      BACKOFF_MAX_MS,
    ]);
  });

  it("applies bounded jitter", () => {
    expect(backoffDelay(3, () => 0)).toBe(3200);
    expect(backoffDelay(3, () => 1)).toBe(4800);
    expect(backoffDelay(30, () => 1)).toBe(BACKOFF_MAX_MS);
  });
});

describe("classifyResponse", () => {
  it.each([
    [200, null, "synced"],
    [201, null, "synced"],
    [0, null, "retry"],
    [500, "INTERNAL_ERROR", "retry"],
    [503, null, "retry"],
    [429, "RATE_LIMITED", "retry"],
    [401, "UNAUTHENTICATED", "auth"],
    [409, "STALE_VERSION", "conflict"],
    [409, "CONFLICT", "conflict"],
    [422, "VALIDATION_FAILED", "failed"],
    [403, "FORBIDDEN", "failed"],
    [404, "NOT_FOUND", "failed"],
  ] as const)("%i %s → %s", (status, code, expected) => {
    expect(classifyResponse(status, code)).toBe(expected);
  });
});

describe("SyncEngine", () => {
  it("sends with the Idempotency-Key header and marks synced", async () => {
    const item = await engine.enqueue(input());
    const result = await engine.syncNow();
    expect(result.synced).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/v1/menu-items/1/availability");
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.headers["idempotency-key"]).toBe(item.idempotencyKey);
    const stored = await db.outbox.get(item.id);
    expect(stored!.status).toBe("synced");
    expect(stored!.serverResponse).toEqual({ ok: true });
  });

  it("merges expectedVersion into the body as `version`", async () => {
    await engine.enqueue(input({ body: { name: "Dal" }, expectedVersion: 7 }));
    await engine.syncNow();
    expect(calls[0]!.body).toEqual({ name: "Dal", version: 7 });
  });

  it("processes FIFO per scope and blocks a scope behind an unsynced head", async () => {
    const a1 = await engine.enqueue(input({ path: "/a1", scopeKey: "branch:a" }));
    const b1 = await engine.enqueue(input({ path: "/b1", scopeKey: "branch:b" }));
    const a2 = await engine.enqueue(input({ path: "/a2", scopeKey: "branch:a" }));
    responder = (call) => (call.url.endsWith("/a1") ? "network-error" : ok());
    // Network error stops the whole run; nothing after a1 in scope a may be sent.
    await engine.syncNow();
    expect(calls.map((c) => c.url)).not.toContain("/api/v1/a2");
    expect((await db.outbox.get(a2.id))!.status).toBe("pending");
    // Scope b started in parallel and is independent of scope a.
    expect((await db.outbox.get(b1.id))!.status).toBe("synced");

    responder = (call) => (call.url.endsWith("/a1") ? apiError(503, "INTERNAL_ERROR") : ok());
    calls = [];
    await engine.syncNow({ force: true });
    // a1 retried (503), a2 still blocked behind it.
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/a1"]);
    expect((await db.outbox.get(a2.id))!.status).toBe("pending");

    responder = () => ok();
    calls = [];
    await engine.syncNow({ force: true });
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/a1", "/api/v1/a2"]);
    expect((await db.outbox.get(a1.id))!.status).toBe("synced");
    expect((await db.outbox.get(a2.id))!.status).toBe("synced");
  });

  it("retries network errors with backoff and reuses the idempotency key", async () => {
    const item = await engine.enqueue(input());
    responder = () => "network-error";

    await engine.syncNow();
    let stored = (await db.outbox.get(item.id))!;
    expect(stored.status).toBe("pending");
    expect(stored.attempts).toBe(1);
    expect(stored.nextAttemptAt).toBe(now + 1000);
    expect(stored.lastErrorCode).toBe("NETWORK_ERROR");

    // Not due yet: nothing is sent.
    await engine.syncNow();
    expect(calls).toHaveLength(1);

    now += 1000;
    await engine.syncNow();
    stored = (await db.outbox.get(item.id))!;
    expect(stored.attempts).toBe(2);
    expect(stored.nextAttemptAt).toBe(now + 2000);

    now += 2000;
    await engine.syncNow();
    stored = (await db.outbox.get(item.id))!;
    expect(stored.nextAttemptAt).toBe(now + 4000);

    responder = () => ok();
    now += 4000;
    await engine.syncNow();
    expect((await db.outbox.get(item.id))!.status).toBe("synced");
    expect(calls).toHaveLength(4);
    expect(new Set(calls.map((c) => c.headers["idempotency-key"]))).toEqual(
      new Set([item.idempotencyKey]),
    );
  });

  it("honours Retry-After on 429", async () => {
    const item = await engine.enqueue(input());
    responder = () =>
      json(429, { error: { code: "RATE_LIMITED", message: "Slow down" } }, { "retry-after": "30" });
    await engine.syncNow();
    const stored = (await db.outbox.get(item.id))!;
    expect(stored.status).toBe("pending");
    expect(stored.nextAttemptAt).toBe(now + 30_000);
  });

  it("keeps 409 STALE_VERSION as a conflict with the server message", async () => {
    const item = await engine.enqueue(input({ expectedVersion: 3 }));
    responder = () => apiError(409, "STALE_VERSION", "Changed by someone else");
    const result = await engine.syncNow();
    expect(result.conflicts).toBe(1);
    const stored = (await db.outbox.get(item.id))!;
    expect(stored.status).toBe("conflict");
    expect(stored.lastError).toBe("Changed by someone else");
    expect(stored.lastErrorCode).toBe("STALE_VERSION");

    // Never retried automatically, even much later.
    now += 60 * 60_000;
    await engine.syncNow({ force: true });
    expect(calls).toHaveLength(1);
    expect(await db.outbox.get(item.id)).toBeDefined();
  });

  it("retry-with-latest drops the version check and uses a new key", async () => {
    const item = await engine.enqueue(
      input({ body: { name: "Dal", version: 3 }, expectedVersion: 3 }),
    );
    responder = () => apiError(409, "STALE_VERSION");
    await engine.syncNow();
    responder = () => ok();
    expect(await engine.retryWithLatest(item.id)).toBe(true);
    await engine.syncNow();
    expect(calls[1]!.body).toEqual({ name: "Dal" });
    expect(calls[1]!.headers["idempotency-key"]).not.toBe(item.idempotencyKey);
    expect((await db.outbox.get(item.id))!.status).toBe("synced");
  });

  it("keeps 422 validation failures as failed until the user dismisses them", async () => {
    const item = await engine.enqueue(input());
    const later = await engine.enqueue(input({ path: "/later" }));
    responder = () => apiError(422, "VALIDATION_FAILED", "Price must be positive");
    const result = await engine.syncNow();
    expect(result.failed).toBe(1);
    const stored = (await db.outbox.get(item.id))!;
    expect(stored.status).toBe("failed");
    expect(stored.lastError).toBe("Price must be positive");
    // The failed head blocks its scope; the later item waits.
    expect((await db.outbox.get(later.id))!.status).toBe("pending");
    expect(calls).toHaveLength(1);

    // Explicit user retry.
    responder = () => ok();
    await engine.retry(item.id);
    await engine.syncNow();
    expect((await db.outbox.get(item.id))!.status).toBe("synced");
    expect((await db.outbox.get(later.id))!.status).toBe("synced");
  });

  it.each([403, 404])("keeps %i as failed", async (status) => {
    const item = await engine.enqueue(input());
    responder = () => apiError(status, status === 403 ? "FORBIDDEN" : "NOT_FOUND");
    await engine.syncNow();
    expect((await db.outbox.get(item.id))!.status).toBe("failed");
  });

  it("never deletes items without an explicit discard", async () => {
    const statuses = [
      () => "network-error" as const,
      () => apiError(500, "INTERNAL_ERROR"),
      () => apiError(409, "STALE_VERSION"),
      () => apiError(422, "VALIDATION_FAILED"),
      () => apiError(403, "FORBIDDEN"),
      () => apiError(401, "UNAUTHENTICATED"),
    ];
    const items = [];
    for (const [i, r] of statuses.entries()) {
      items.push(await engine.enqueue(input({ scopeKey: `s${i}`, path: `/p${i}` })));
      responder = r;
      await engine.syncNow({ force: true });
    }
    now += 365 * 24 * 60 * 60_000; // a year later
    await engine.prune();
    await engine.recoverStuck();
    for (const item of items) expect(await db.outbox.get(item.id)).toBeDefined();

    expect(await engine.discard(items[0]!.id)).toBe(true);
    expect(await db.outbox.get(items[0]!.id)).toBeUndefined();
  });

  it("keeps 401 items pending and stops the run", async () => {
    const a = await engine.enqueue(input({ scopeKey: "a", path: "/a" }));
    await engine.enqueue(input({ scopeKey: "b", path: "/b" }));
    responder = () => apiError(401, "UNAUTHENTICATED");
    await engine.syncNow();
    const stored = (await db.outbox.get(a.id))!;
    expect(stored.status).toBe("pending");
    expect(stored.lastError).toMatch(/sign in/i);
  });

  it("recovers items stuck in syncing after a reload", async () => {
    const item = await engine.enqueue(input());
    await db.outbox.update(item.id, { status: "syncing", attempts: 1, updatedAt: now });

    // A fresh "syncing" item may still be in flight in another tab: leave it.
    await engine.syncNow();
    expect(calls).toHaveLength(0);
    expect((await db.outbox.get(item.id))!.status).toBe("syncing");

    now += STUCK_SYNCING_MS + 1;
    const reloaded = makeEngine();
    await reloaded.syncNow();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.headers["idempotency-key"]).toBe(item.idempotencyKey);
    const stored = (await db.outbox.get(item.id))!;
    expect(stored.status).toBe("synced");
    expect(stored.attempts).toBe(2);
  });

  it("only sends items of the signed-in user", async () => {
    const mine = await engine.enqueue(input());
    userId = "user-2";
    const theirs = await engine.enqueue(input({ scopeKey: "other" }));
    userId = "user-1";
    await engine.syncNow();
    expect(calls).toHaveLength(1);
    expect((await db.outbox.get(mine.id))!.status).toBe("synced");
    expect((await db.outbox.get(theirs.id))!.status).toBe("pending");
    // And another user can't discard someone else's item through the engine.
    expect(await engine.discard(theirs.id)).toBe(false);

    userId = null;
    await expect(engine.enqueue(input())).rejects.toThrow(/sign in/i);
  });

  it("sends nothing when the server says the session belongs to someone else", async () => {
    await engine.enqueue(input());
    let sessionOwner: string | null = "user-2";
    const guarded = new SyncEngine({
      db,
      getUserId: () => userId,
      fetch: async (url) => {
        calls.push({ url, method: "PATCH", headers: {}, body: undefined });
        return ok();
      },
      confirmSession: async () => sessionOwner,
    });
    await guarded.syncNow();
    expect(calls).toHaveLength(0);
    sessionOwner = null; // signed out / offline
    await guarded.syncNow();
    expect(calls).toHaveLength(0);
    sessionOwner = "user-1";
    await guarded.syncNow();
    expect(calls).toHaveLength(1);
  });

  it("shares one run between concurrent sync calls", async () => {
    await engine.enqueue(input());
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    responder = async () => {
      await gate;
      return ok();
    };
    const first = engine.syncNow();
    const second = engine.syncNow();
    release();
    await Promise.all([first, second]);
    expect(calls).toHaveLength(1);
  });

  it("skips the run when another tab holds the lock", async () => {
    await engine.enqueue(input());
    const locked = new SyncEngine({
      db,
      getUserId: () => userId,
      fetch: async () => ok(),
      withLock: async () => false,
    });
    const result = await locked.syncNow();
    expect(result.skipped).toBe(true);
  });
});

describe("switchUser", () => {
  it("clears another user's cached data but keeps their unsynced changes", async () => {
    await switchUser(db, "user-1");
    await db.queryCache.put({
      key: "k",
      queryKey: ["me"],
      data: 1,
      updatedAt: 1,
      userId: "user-1",
    });
    await db.drafts.put({ key: "user-1:d", userId: "user-1", value: "x", updatedAt: 1 });
    const pending = await engine.enqueue(input());
    const synced = await engine.enqueue(input({ scopeKey: "z" }));
    await db.outbox.update(synced.id, { status: "synced" });

    expect(await switchUser(db, "user-2")).toBe(true);
    expect(await db.queryCache.count()).toBe(0);
    expect(await db.drafts.count()).toBe(0);
    expect(await db.outbox.get(pending.id)).toBeDefined();
    expect(await db.outbox.get(synced.id)).toBeUndefined();
    expect(await switchUser(db, "user-2")).toBe(false);
  });
});
