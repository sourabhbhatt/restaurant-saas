import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOfflineDb, switchUser, type OfflineDatabase } from "./db";
import {
  PERSIST_MAX_AGE_MS,
  hydrateQueries,
  queryCacheKey,
  shouldPersistQuery,
  startQueryPersistence,
} from "./persist-queries";

/** Let fake-indexeddb (scheduled with setImmediate) and promises settle. */
async function settle() {
  for (let i = 0; i < 30; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

let db: OfflineDatabase;
let qc: QueryClient;

beforeEach(() => {
  db = createOfflineDb(`persist-${crypto.randomUUID()}`);
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(async () => {
  qc.clear();
  db.close();
  await db.delete();
  vi.useRealTimers();
});

describe("shouldPersistQuery", () => {
  it("selects session/structure/context queries and meta.persist", () => {
    expect(shouldPersistQuery({ queryKey: ["me"] })).toBe(true);
    expect(shouldPersistQuery({ queryKey: ["branch", "b1", "context"] })).toBe(true);
    expect(shouldPersistQuery({ queryKey: ["workspace", "w1", "structure"] })).toBe(true);
    expect(shouldPersistQuery({ queryKey: ["orders", "b1"], meta: { persist: true } })).toBe(true);
    expect(shouldPersistQuery({ queryKey: ["orders", "b1"] })).toBe(false);
    expect(shouldPersistQuery({ queryKey: ["branch", "b1", "orders"] })).toBe(false);
  });
});

describe("query persistence", () => {
  it("also saves results that arrived before persistence started", async () => {
    await qc.fetchQuery({ queryKey: ["me"], queryFn: async () => ({ user: { id: "u1" } }) });
    await qc.fetchQuery({
      queryKey: ["branch", "b1", "context"],
      queryFn: async () => ({ branch: { id: "b1" } }),
    });
    await qc.fetchQuery({ queryKey: ["orders", "b1"], queryFn: async () => [] });
    const stop = startQueryPersistence(qc, db, () => "u1");
    await settle();
    const rows = await db.queryCache.toArray();
    expect(rows.map((r) => r.key).sort()).toEqual(
      [queryCacheKey(["branch", "b1", "context"]), queryCacheKey(["me"])].sort(),
    );
    expect(rows.every((r) => r.userId === "u1")).toBe(true);
    stop();
  });

  it("writes successful network results for the confirmed user", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stop = startQueryPersistence(qc, db, () => "user-1");
    await qc.fetchQuery({
      queryKey: ["branch", "b1", "context"],
      queryFn: async () => ({ name: "Main" }),
    });
    await qc.fetchQuery({ queryKey: ["not", "persisted"], queryFn: async () => 1 });
    await vi.advanceTimersByTimeAsync(1000);
    vi.useRealTimers();
    stop();
    const rows = await db.queryCache.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.key).toBe(queryCacheKey(["branch", "b1", "context"]));
    expect(rows[0]!.userId).toBe("user-1");
    expect(rows[0]!.data).toEqual({ name: "Main" });
  });

  it("saves the first result of each query at once, before the debounce", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stop = startQueryPersistence(qc, db, () => "user-1");
    await qc.fetchQuery({ queryKey: ["me"], queryFn: async () => ({ user: { id: "user-1" } }) });
    await qc.fetchQuery({
      queryKey: ["branch", "b1", "context"],
      queryFn: async () => ({ name: "Main" }),
    });
    // No timer advanced: a reload or lost connection right now must still find the data.
    vi.useRealTimers();
    await settle();
    const keys = (await db.queryCache.toArray()).map((r) => r.key).sort();
    expect(keys).toEqual(
      [queryCacheKey(["branch", "b1", "context"]), queryCacheKey(["me"])].sort(),
    );
    stop();
  });

  it("writes a pending (debounced) update at once when the tab is hidden", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const stop = startQueryPersistence(qc, db, () => "user-1");
    const queryKey = ["branch", "b1", "context"];
    await qc.fetchQuery({ queryKey, queryFn: async () => ({ name: "Main" }) });
    await qc.fetchQuery({ queryKey, queryFn: async () => ({ name: "Renamed" }), staleTime: 0 });
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    visibility.mockRestore();
    vi.useRealTimers();
    await settle();
    const row = await db.queryCache.get(queryCacheKey(queryKey));
    expect(row?.data).toEqual({ name: "Renamed" });
    stop();
  });

  it("restores only the last signed-in user's fresh rows, marked stale", async () => {
    await switchUser(db, "user-1");
    const now = Date.now();
    await db.queryCache.bulkPut([
      {
        key: queryCacheKey(["me"]),
        queryKey: ["me"],
        data: { user: { id: "user-1" } },
        updatedAt: now - 60_000,
        userId: "user-1",
      },
      {
        key: queryCacheKey(["workspace", "w", "structure"]),
        queryKey: ["workspace", "w", "structure"],
        data: { old: true },
        updatedAt: now - PERSIST_MAX_AGE_MS - 1,
        userId: "user-1",
      },
    ]);
    const result = await hydrateQueries(qc, db, now);
    expect(result.userId).toBe("user-1");
    expect(result.restored).toEqual([["me"]]);
    expect(qc.getQueryData(["me"])).toEqual({ user: { id: "user-1" } });
    expect(qc.getQueryState(["me"])!.dataUpdatedAt).toBe(now - 60_000);
    expect(qc.getQueryData(["workspace", "w", "structure"])).toBeUndefined();
  });

  it("does not overwrite fresher in-memory data", async () => {
    await switchUser(db, "user-1");
    qc.setQueryData(["me"], { user: { id: "user-1" }, fresh: true });
    await db.queryCache.put({
      key: queryCacheKey(["me"]),
      queryKey: ["me"],
      data: { user: { id: "user-1" } },
      updatedAt: 1,
      userId: "user-1",
    });
    await hydrateQueries(qc, db);
    expect(qc.getQueryData(["me"])).toEqual({ user: { id: "user-1" }, fresh: true });
  });

  it("restored rows are refetched by the screen even when saved seconds ago (within staleTime)", async () => {
    await switchUser(db, "user-1");
    const queryKey = ["workspace", "w1", "structure"];
    await db.queryCache.put({
      key: queryCacheKey(queryKey),
      queryKey,
      data: { plan: "Pro" },
      updatedAt: Date.now() - 2_000, // a reload right after the last fetch
      userId: "user-1",
    });
    await hydrateQueries(qc, db);
    expect(qc.getQueryData(queryKey)).toEqual({ plan: "Pro" });

    const queryFn = vi.fn(async () => ({ plan: "Enterprise" }));
    const observer = new QueryObserver(qc, { queryKey, queryFn, staleTime: 30_000 });
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(qc.getQueryData(queryKey)).toEqual({ plan: "Enterprise" }));
    expect(queryFn).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});
