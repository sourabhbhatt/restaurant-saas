import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";

import { getStoredUserId, type OfflineDatabase } from "./db";

/**
 * Small custom TanStack Query persister over Dexie (no extra dependency).
 *
 * Successful results of selected queries are written to `queryCache` and
 * restored on startup so dashboards, menus and order history that were
 * loaded before still render offline. Restored data keeps its original
 * `dataUpdatedAt`, so it is stale and refetched as soon as possible.
 */

/** Cached rows older than this are not restored. */
export const PERSIST_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
const WRITE_DEBOUNCE_MS = 300;

/**
 * Which queries are persisted:
 * - ["branch", id, "context"], ["workspace", id, "structure"], ["me"]
 * - any query declared with `meta: { persist: true }`
 */
export function shouldPersistQuery(query: {
  queryKey: QueryKey;
  meta?: Record<string, unknown> | undefined;
}): boolean {
  const [a, , c] = query.queryKey;
  if (query.meta?.persist === true) return true;
  if (query.queryKey.length === 1 && a === "me") return true;
  if (query.queryKey.length === 3 && a === "branch" && c === "context") return true;
  if (query.queryKey.length === 3 && a === "workspace" && c === "structure") return true;
  return false;
}

export const queryCacheKey = (queryKey: QueryKey) => JSON.stringify(queryKey);
const ME_KEY = queryCacheKey(["me"]);

function userIdFromMe(data: unknown): string | null {
  const id = (data as { user?: { id?: unknown } } | null)?.user?.id;
  return typeof id === "string" ? id : null;
}

export interface HydrationResult {
  userId: string | null;
  restored: QueryKey[];
}

/** Restore the last signed-in user's persisted queries into the QueryClient. */
export async function hydrateQueries(
  queryClient: QueryClient,
  db: OfflineDatabase,
  now: number = Date.now(),
): Promise<HydrationResult> {
  const userId = await getStoredUserId(db);
  if (!userId) return { userId: null, restored: [] };
  const rows = await db.queryCache.where("userId").equals(userId).toArray();
  const restored: QueryKey[] = [];
  for (const row of rows) {
    if (now - row.updatedAt > PERSIST_MAX_AGE_MS) continue;
    const current = queryClient.getQueryState(row.queryKey);
    // Never overwrite fresher data that already arrived from the network.
    if (current && current.dataUpdatedAt >= row.updatedAt && current.data !== undefined) continue;
    queryClient.setQueryData(row.queryKey, row.data, { updatedAt: row.updatedAt });
    // A row saved seconds before a reload would count as fresh (staleTime) and never be
    // refetched, so the screen kept e.g. the old plan or permissions. Mark it stale: the
    // screen shows it at once and asks the server as soon as it can.
    void queryClient.invalidateQueries({
      queryKey: row.queryKey,
      exact: true,
      refetchType: "none",
    });
    restored.push(row.queryKey);
  }
  return { userId, restored };
}

/**
 * Write successful network results of persisted queries to IndexedDB.
 * `getUserId` must return the server-confirmed user; nothing is written
 * while it is unknown (except ["me"], which carries its own user id).
 */
export function startQueryPersistence(
  queryClient: QueryClient,
  db: OfflineDatabase,
  getUserId: () => string | null,
): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const write = (query: Query) => {
    const data = query.state.data;
    if (data === undefined) return;
    const isMe = query.queryKey.length === 1 && query.queryKey[0] === "me";
    const userId = isMe ? userIdFromMe(data) : getUserId();
    if (!userId) return;
    void db.queryCache
      .put({
        key: queryCacheKey(query.queryKey),
        queryKey: [...query.queryKey],
        data,
        updatedAt: query.state.dataUpdatedAt || Date.now(),
        userId,
      })
      .catch(() => {
        // Quota or private mode: persistence is best-effort.
      });
  };

  const pendingQueries = new Map<string, Query>();
  /** Keys written since this page loaded: only later updates are debounced. */
  const written = new Set<string>();
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success") return;
    // `manual` results come from setQueryData (incl. hydration), not the server.
    if (event.action.manual) return;
    const query = event.query;
    if (!shouldPersistQuery(query)) return;
    const key = queryCacheKey(query.queryKey);
    // The first result is saved at once: a screen that loses its connection (or is
    // reloaded) right after it loaded must still have something to show offline.
    if (!written.has(key) && (key === ME_KEY || getUserId())) {
      written.add(key);
      write(query);
      return;
    }
    const pending = timers.get(key);
    if (pending) clearTimeout(pending);
    pendingQueries.set(key, query);
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        pendingQueries.delete(key);
        write(query);
      }, WRITE_DEBOUNCE_MS),
    );
  });

  // Backgrounding the tab (tablets often kill hidden tabs) must not drop the newest
  // debounced update. On unload this is best effort only.
  const flush = () => {
    for (const [key, query] of pendingQueries) {
      clearTimeout(timers.get(key));
      timers.delete(key);
      write(query);
    }
    pendingQueries.clear();
  };
  const onHidden = () => {
    if (document.visibilityState === "hidden") flush();
  };
  const hasWindow = typeof window !== "undefined";
  if (hasWindow) {
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
  }

  return () => {
    unsubscribe();
    if (hasWindow) {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
    }
    for (const t of timers.values()) clearTimeout(t);
    timers.clear();
    pendingQueries.clear();
  };
}
