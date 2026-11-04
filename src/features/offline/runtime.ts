"use client";

import { onlineManager, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { liveQuery } from "dexie";

import { getOfflineDb, switchUser, type OfflineDatabase, type OutboxItem } from "./db";
import { hydrateQueries, startQueryPersistence } from "./persist-queries";
import { SyncEngine, type EnqueueInput } from "./sync-engine";
import { countItems, setSyncState, useSyncStore } from "./sync-store";

/**
 * Browser runtime for the offline layer: one sync engine per tab, the query
 * persister, connectivity probing and the sync triggers (startup, `online`,
 * visibility change, interval, manual). Background Sync is not relied upon.
 */

export const SYNC_INTERVAL_MS = 30_000;
export const PING_PATH = "/api/v1/sync/ping";
const LOCK_NAME = "restaurantos-outbox-sync";

/** Device user: owner of new local changes (may come from cached data while offline). */
let deviceUserId: string | null = null;
/** User confirmed by a live server response for the current session cookie. */
let sessionUserId: string | null = null;
let engine: SyncEngine | null = null;
let queryClientRef: QueryClient | null = null;
let stopFns: (() => void)[] = [];
let outboxSubscription: { unsubscribe(): void } | null = null;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;
let hydratedKeys: QueryKey[] = [];

async function withNavigatorLock(work: () => Promise<void>): Promise<boolean> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  // Without Web Locks every item is still claimed atomically in IndexedDB,
  // so two tabs can never send the same item concurrently.
  if (!locks?.request) {
    await work();
    return true;
  }
  return locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
    if (!lock) return false;
    await work();
    return true;
  });
}

function setOnline(online: boolean): void {
  const was = useSyncStore.getState().online;
  setSyncState(online ? { online, lastOnlineAt: Date.now() } : { online });
  onlineManager.setOnline(online);
  if (online && !was) void getSyncEngine()?.syncNow();
}

export function getSyncEngine(): SyncEngine | null {
  if (engine) return engine;
  const db = getOfflineDb();
  if (!db) return null;
  engine = new SyncEngine({
    db,
    fetch: (url, init) => fetch(url, init),
    getUserId: () => deviceUserId,
    getSessionUserId: () => sessionUserId,
    confirmSession,
    withLock: withNavigatorLock,
    onRunStateChange: (syncing) => {
      setSyncState(
        syncing || !useSyncStore.getState().online ? { syncing } : { syncing, lastSyncAt: Date.now() },
      );
      if (!syncing) void scheduleWake();
    },
    onItemSynced: (item) => {
      for (const queryKey of item.invalidateKeys ?? []) {
        void queryClientRef?.invalidateQueries({ queryKey });
      }
    },
    onConnectivity: (online) => {
      if (online !== useSyncStore.getState().online) setOnline(online);
    },
    onAuthRequired: (authRequired) => setSyncState({ authRequired }),
  });
  return engine;
}

/** Live check of the session owner before a sync run (null when signed out/offline). */
async function confirmSession(): Promise<string | null> {
  try {
    const res = await fetch("/api/v1/auth/me", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) {
      setSyncState({ authRequired: true });
      return null;
    }
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: { user?: { id?: string } } };
    const id = body.data?.user?.id ?? null;
    if (id && id !== sessionUserId) {
      await setCurrentUser(id, true);
    }
    setSyncState({ authRequired: false });
    return id;
  } catch {
    return null;
  }
}

/** Wake up when the earliest backed-off item becomes due. */
async function scheduleWake(): Promise<void> {
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = null;
  const due = await engine?.nextDueAt();
  if (due == null) return;
  const delay = Math.max(250, due - Date.now());
  if (delay > SYNC_INTERVAL_MS) return; // the interval covers it
  wakeTimer = setTimeout(() => void getSyncEngine()?.syncNow(), delay);
}

/** Verify real connectivity (navigator.onLine can claim "online" on dead Wi-Fi). */
export async function probeConnectivity(): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setOnline(false);
    return false;
  }
  try {
    const res = await fetch(PING_PATH, {
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(5_000),
    });
    // Any HTTP response means the server is reachable.
    setOnline(true);
    return res.ok;
  } catch {
    setOnline(false);
    return false;
  }
}

function watchOutbox(db: OfflineDatabase): void {
  outboxSubscription?.unsubscribe();
  const userId = deviceUserId;
  // liveQuery also fires for changes made by other tabs.
  outboxSubscription = liveQuery(async () => {
    const all = await db.outbox.toArray();
    return all;
  }).subscribe({
    next: (all: OutboxItem[]) => {
      const items = all
        .filter((i) => i.userId === userId)
        .sort((a, b) => a.createdAt - b.createdAt);
      setSyncState({
        items,
        counts: countItems(items),
        otherUserPending: all.filter((i) => i.userId !== userId && i.status !== "synced").length,
      });
    },
    error: () => {
      // IndexedDB unavailable (private mode): the indicator just shows nothing queued.
    },
  });
}

/**
 * Tell the runtime who is signed in. `confirmed` means the identity came
 * from a live server response (not restored cache): only then are queued
 * changes sent and the previous user's local data cleared.
 */
export async function setCurrentUser(userId: string | null, confirmed: boolean): Promise<void> {
  const db = getOfflineDb();
  if (!db) return;
  if (confirmed) {
    if (userId) {
      const changed = await switchUser(db, userId);
      if (changed && queryClientRef) {
        // Drop the previous user's restored data from memory too.
        for (const queryKey of hydratedKeys) {
          queryClientRef.removeQueries({ queryKey, exact: true });
        }
        hydratedKeys = [];
      }
    } else {
      // Signed out / session expired: forget cached server data on this device.
      await db.queryCache.clear().catch(() => {});
    }
    sessionUserId = userId;
  }
  // A user restored from cache never overrides the one the server confirmed.
  const nextDevice = confirmed ? userId : (sessionUserId ?? userId);
  if (nextDevice !== deviceUserId) {
    deviceUserId = nextDevice;
    setSyncState({ userId: nextDevice });
    watchOutbox(db);
  }
  if (sessionUserId) void getSyncEngine()?.syncNow();
}

function trackUser(queryClient: QueryClient): () => void {
  return queryClient.getQueryCache().subscribe((event) => {
    const { queryKey } = event.query;
    if (queryKey.length !== 1 || queryKey[0] !== "me") return;
    // queryClient.clear() on sign-out: the session owner is unknown until /auth/me answers.
    if (event.type === "removed") {
      sessionUserId = null;
      return;
    }
    if (event.type !== "updated") return;
    if (event.action.type === "success") {
      const id = (event.action.data as { user?: { id?: string } } | undefined)?.user?.id ?? null;
      void setCurrentUser(id, !event.action.manual);
    } else if (event.action.type === "error") {
      const status = (event.action.error as { status?: number } | null)?.status;
      if (status === 401) void setCurrentUser(null, true);
    }
  });
}

/** Start the offline layer once per tab. Returns a cleanup function. */
export function startOfflineRuntime(queryClient: QueryClient): () => void {
  if (typeof window === "undefined") return () => {};
  const db = getOfflineDb();
  const sync = getSyncEngine();
  if (!db || !sync) return () => {};
  stopOfflineRuntime();
  queryClientRef = queryClient;

  stopFns.push(trackUser(queryClient));
  stopFns.push(startQueryPersistence(queryClient, db, () => sessionUserId));

  // Pick up a user that a live request already loaded (nothing is restored yet).
  const meId = queryClient.getQueryData<{ user?: { id?: string } }>(["me"])?.user?.id;
  if (meId) void setCurrentUser(meId, true);

  void hydrateQueries(queryClient, db)
    .then((result) => {
      hydratedKeys = result.restored;
      const restoredMe = queryClient.getQueryData<{ user?: { id?: string } }>(["me"]);
      if (!deviceUserId && restoredMe?.user?.id) void setCurrentUser(restoredMe.user.id, false);
    })
    .catch(() => {});

  void sync.recoverStuck().catch(() => {});
  watchOutbox(db);

  const syncSoon = () => {
    void probeConnectivity().then((reachable) => {
      if (reachable) void sync.syncNow();
    });
  };
  const onOnline = () => syncSoon();
  const onOffline = () => setOnline(false);
  const onVisible = () => {
    if (document.visibilityState === "visible") syncSoon();
  };
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  document.addEventListener("visibilitychange", onVisible);
  const interval = setInterval(() => {
    const state = useSyncStore.getState();
    if (!state.online || state.counts.pending > 0) syncSoon();
  }, SYNC_INTERVAL_MS);
  stopFns.push(() => {
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisible);
    clearInterval(interval);
  });

  // Startup sync.
  syncSoon();
  return stopOfflineRuntime;
}

export function stopOfflineRuntime(): void {
  for (const stop of stopFns) stop();
  stopFns = [];
  outboxSubscription?.unsubscribe();
  outboxSubscription = null;
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = null;
}

// ----------------------------------------------------------------- public API

/**
 * Queue a mutation that may be applied later (draft-able operations ONLY:
 * menu availability toggles, menu item edits, settings drafts). Never use it
 * for customer order submission, order acceptance or payments: those are
 * server-authoritative and must not appear confirmed while offline.
 *
 * Use an endpoint that declares idempotency, or a naturally idempotent
 * PUT/PATCH with `expectedVersion`. Sync starts immediately when online.
 */
export async function enqueueMutation(input: EnqueueInput): Promise<OutboxItem> {
  const sync = getSyncEngine();
  if (!sync) throw new Error("Offline storage is not available in this browser.");
  const item = await sync.enqueue(input);
  if (useSyncStore.getState().online) void sync.syncNow();
  return item;
}

/** Manual "Sync now": probes connectivity and ignores backoff timers. */
export async function syncNow(): Promise<void> {
  const sync = getSyncEngine();
  if (!sync) return;
  await probeConnectivity();
  await sync.syncNow({ force: true });
}

export async function retryOutboxItem(id: string): Promise<void> {
  const sync = getSyncEngine();
  if (!sync) return;
  await sync.retry(id);
  await sync.syncNow();
}

export async function retryOutboxItemWithLatest(id: string): Promise<void> {
  const sync = getSyncEngine();
  if (!sync) return;
  await sync.retryWithLatest(id);
  await sync.syncNow();
}

/** Explicit user action only (behind a confirmation). */
export async function discardOutboxItem(id: string): Promise<void> {
  const sync = getSyncEngine();
  if (!sync) return;
  const removed = await sync.discard(id);
  if (!removed) throw new Error("This change is being sent right now. Try again in a moment.");
}

export async function discardOtherAccountsChanges(): Promise<void> {
  await getSyncEngine()?.discardOtherUsers();
}

export async function clearSyncedHistory(): Promise<void> {
  await getSyncEngine()?.clearSynced();
}
