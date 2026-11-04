import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createOfflineDb, switchUser, type OfflineDatabase } from "./db";
import {
  PERSIST_MAX_AGE_MS,
  hydrateQueries,
  queryCacheKey,
  shouldPersistQuery,
  startQueryPersistence,
} from "./persist-queries";

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
});
