"use client";

import { onlineManager, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { liveQuery } from "dexie";

import { api, newIdempotencyKey } from "@ros/api-client";

import {
  clearUserData,
  getOfflineDb,
  switchUser,
  type OfflineDatabase,
  type OutboxItem,
} from "./db";
import { hydrateQueries, persistExistingQueries, startQueryPersistence } from "./persist-queries";
import { backoffDelay, SyncEngine, type EnqueueInput } from "./sync-engine";
import { countItems, EMPTY_COUNTS, setSyncState, useSyncStore } from "./sync-store";

/**
 * Browser runtime for the offline layer: one sync engine per tab, the query
 * persister, connectivity probing and the sync triggers (startup, `online`,
 * visibility change, interval, manual). Background Sync is not relied upon.
 */

export const SYNC_INTERVAL_MS = 30_000;
export const PING_PATH = "/api/v1/sync/ping";
/**
 * After a probe fails while the browser reports a connection, probe again
 * after these delays (ms) before leaving it to the interval: `online` often
 * fires before the network carries traffic (Wi-Fi still joining), and the
 * screen would otherwise say "Offline" and hold queued changes for up to
 * SYNC_INTERVAL_MS after the device is back.
 */
export const REPROBE_DELAYS_MS = [1_000, 2_000, 4_000, 8_000] as const;
const LOCK_NAME = "restaurantos-outbox-sync";

/** Device user: owner of new local changes (may come from cached data while offline). */
let deviceUserId: string | null = null;
/**
 * Whether the runtime has learned who is (or is not) signed in since it
 * started. Until then a change waits for it (see waitForDeviceUser).
 */
let userKnown = false;
let userWaiters: (() => void)[] = [];
/** User confirmed by a live server response for the current session cookie. */
let sessionUserId: string | null = null;
let engine: SyncEngine | null = null;
let queryClientRef: QueryClient | null = null;
let stopFns: (() => void)[] = [];
let outboxSubscription: { unsubscribe(): void } | null = null;
let wakeTimer: ReturnType<typeof setTimeout> | null = null;
let hydratedKeys: QueryKey[] = [];
/** Consecutive failed session checks (401, 5xx, offline) and when the next may run. */
let confirmFailures = 0;
let confirmBackoffUntil = 0;

/**
 * A successful session check is reused for this long: every sync run asks
 * /auth/me first, so without this each online kitchen tap cost two round trips.
 */
export const SESSION_CHECK_TTL_MS = 30_000;
/** When the server last confirmed `sessionUserId` (0: ask before the next send). */
let sessionCheckedAt = 0;

/**
 * Ask the server again before the next send: on `online`, when the tab
 * becomes visible, at sign-out or a user change, and after any 401.
 */
export function forgetSessionCheck(): void {
  sessionCheckedAt = 0;
}

/**
 * Forget the session-check backoff: called on `online`, `visibilitychange`,
 * manual sync and any successful /auth/me answer.
 */
export function resetSessionBackoff(): void {
  confirmFailures = 0;
  confirmBackoffUntil = 0;
}

function sessionCheckFailed(): null {
  confirmFailures += 1;
  confirmBackoffUntil = Date.now() + backoffDelay(confirmFailures);
  return null;
}

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
    // Candidate owner; confirmSession() verifies it with the server before sending.
    getSessionUserId: () => sessionUserId ?? deviceUserId,
    confirmSession,
    withLock: withNavigatorLock,
    onRunStateChange: (syncing) => {
      setSyncState(
        syncing || !useSyncStore.getState().online
          ? { syncing }
          : { syncing, lastSyncAt: Date.now() },
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
    onAuthRequired: (authRequired) => {
      if (authRequired) forgetSessionCheck();
      setSyncState({ authRequired });
    },
  });
  return engine;
}

/**
 * Live check of the session owner before a sync run (null when signed out/offline).
 * After a failure further checks back off (1 s doubling to 5 min) instead of
 * re-asking the server on every wake-up.
 */
async function confirmSession(): Promise<string | null> {
  if (sessionUserId && sessionCheckedAt && Date.now() - sessionCheckedAt < SESSION_CHECK_TTL_MS) {
    return sessionUserId;
  }
  if (Date.now() < confirmBackoffUntil) return null;
  try {
    const res = await fetch("/api/v1/auth/me", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401) {
      forgetSessionCheck();
      setSyncState({ authRequired: true });
      return sessionCheckFailed();
    }
    if (!res.ok) return sessionCheckFailed();
    const body = (await res.json()) as { data?: { user?: { id?: string } } };
    const id = body.data?.user?.id ?? null;
    if (id && id !== sessionUserId) {
      await setCurrentUser(id, true);
    }
    if (!id) return sessionCheckFailed();
    resetSessionBackoff();
    sessionCheckedAt = Date.now();
    setSyncState({ authRequired: false });
    return id;
  } catch {
    return sessionCheckFailed();
  }
}

/**
 * Wake up when the earliest backed-off item becomes due (not before the
 * session-check backoff ends). Nothing is scheduled while the session expired:
 * signing in again restarts syncing.
 */
async function scheduleWake(): Promise<void> {
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = null;
  if (useSyncStore.getState().authRequired) return;
  const due = await engine?.nextDueAt();
  if (due == null) return;
  const now = Date.now();
  const delay = Math.max(250, due - now, confirmBackoffUntil - now);
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
    // The body is never needed: release it, or the request stays open until the 5 s abort.
    void res.body?.cancel().catch(() => undefined);
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
 * How long a change made before the runtime knows the signed-in user waits for
 * it (a fresh page: the screen can be tappable before /auth/me has answered).
 */
export const DEVICE_USER_WAIT_MS = 5_000;

function userBecameKnown(): void {
  userKnown = true;
  for (const wake of userWaiters.splice(0)) wake();
}

/** Resolves when the device user is known, or after DEVICE_USER_WAIT_MS. */
function waitForDeviceUser(): Promise<void> {
  if (deviceUserId || userKnown) return Promise.resolve();
  return new Promise((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      userWaiters = userWaiters.filter((w) => w !== wake);
      resolve();
    }, DEVICE_USER_WAIT_MS);
    userWaiters.push(wake);
  });
}

/**
 * Called on explicit sign-out so the next account never sees this one's cached
 * data, outbox items or counts, and never queues changes under this account.
 * Its unsynced items stay in IndexedDB (hidden, counted as another account's).
 */
export async function clearDeviceUserData(): Promise<void> {
  const db = getOfflineDb();
  hydratedKeys = [];
  sessionUserId = null;
  deviceUserId = null;
  resetSessionBackoff();
  forgetSessionCheck();
  if (wakeTimer) clearTimeout(wakeTimer);
  wakeTimer = null;
  setSyncState({ userId: null, items: [], counts: EMPTY_COUNTS, authRequired: false });
  // Signed out on purpose: a change now fails at once instead of waiting.
  userBecameKnown();
  if (!db) return;
  watchOutbox(db);
  await clearUserData(db).catch(() => {
    // IndexedDB unavailable: nothing cached to clear.
  });
}

/** Unsent changes of the signed-in user on this device (for the sign-out warning). */
export function unsentChangesCount(): number {
  const { counts } = useSyncStore.getState();
  return counts.pending + counts.syncing + counts.failed + counts.conflict;
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
    // A live answer for this user counts as a session check; no user (or another one) does not.
    sessionCheckedAt = userId ? Date.now() : 0;
    sessionUserId = userId;
    // Results that resolved before the session user was confirmed (not written then).
    if (userId && queryClientRef)
      persistExistingQueries(queryClientRef, db, () => sessionUserId, hydratedKeys);
  }
  // A user restored from cache never overrides the one the server confirmed.
  const nextDevice = confirmed ? userId : (sessionUserId ?? userId);
  if (nextDevice !== deviceUserId) {
    deviceUserId = nextDevice;
    setSyncState({ userId: nextDevice });
    watchOutbox(db);
  }
  userBecameKnown();
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
      if (!event.action.manual) resetSessionBackoff();
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
  // A new page: changes wait (briefly) until the runtime learns who is signed in.
  if (!deviceUserId) userKnown = false;

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

  let reprobeTimer: ReturnType<typeof setTimeout> | null = null;
  let reprobeAttempt = 0;
  const cancelReprobe = () => {
    if (reprobeTimer) clearTimeout(reprobeTimer);
    reprobeTimer = null;
  };
  const syncSoon = () => {
    cancelReprobe();
    void probeConnectivity().then((reachable) => {
      if (reachable) {
        reprobeAttempt = 0;
        void sync.syncNow();
        return;
      }
      // Network failure although the browser says it is connected: try again soon.
      const delay = REPROBE_DELAYS_MS[reprobeAttempt];
      if (!useSyncStore.getState().online && navigator.onLine !== false && delay !== undefined) {
        reprobeAttempt += 1;
        cancelReprobe();
        reprobeTimer = setTimeout(syncSoon, delay);
      }
    });
  };
  const onOnline = () => {
    resetSessionBackoff();
    forgetSessionCheck();
    reprobeAttempt = 0;
    syncSoon();
  };
  const onOffline = () => {
    cancelReprobe();
    setOnline(false);
  };
  const onVisible = () => {
    if (document.visibilityState !== "visible") return;
    resetSessionBackoff();
    forgetSessionCheck();
    syncSoon();
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
    cancelReprobe();
  });

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
 * kitchen item status and start/ready, staff-entered orders — see queued-ops.ts). Never use
 * it for guest order submission, order acceptance/rejection, bills, payments,
 * refunds or closing sessions: those are server-authoritative and must not
 * appear confirmed while offline.
 *
 * Use an endpoint that declares idempotency, or a naturally idempotent
 * PUT/PATCH with `expectedVersion`. Sync starts immediately when online.
 */
export async function enqueueMutation(input: EnqueueInput): Promise<OutboxItem> {
  const sync = getSyncEngine();
  if (!sync) throw new Error("Offline storage is not available in this browser.");
  await waitForDeviceUser();
  const item = await sync.enqueue(input);
  if (useSyncStore.getState().online) void sync.syncNow();
  return item;
}

/** Whether this browser can keep changes on the device (IndexedDB is usable). */
export function offlineStorageAvailable(): boolean {
  return getSyncEngine() !== null;
}

/**
 * Without IndexedDB (private mode on some browsers, a storage policy) nothing
 * can be queued. While online, a change is sent at once, built as the engine
 * would send it: the same body with its version field and an idempotency key.
 * It rejects on any error (a 409 included) with the server's message; the
 * caller shows nothing as done until it resolves.
 */
export async function sendWithoutStorage(input: EnqueueInput): Promise<void> {
  const field = input.versionField ?? "version";
  const base = (input.body ?? {}) as Record<string, unknown>;
  const body =
    input.expectedVersion === undefined ? input.body : { ...base, [field]: input.expectedVersion };
  const opts = { idempotencyKey: input.idempotencyKey ?? newIdempotencyKey() };
  if (input.method === "POST") await api.post(input.path, body, opts);
  else if (input.method === "PATCH") await api.patch(input.path, body, opts);
  else if (input.method === "PUT") await api.put(input.path, body, opts);
  else await api.delete(input.path, opts);
}

/** Manual "Sync now": probes connectivity and ignores backoff timers. */
export async function syncNow(): Promise<void> {
  const sync = getSyncEngine();
  if (!sync) return;
  resetSessionBackoff();
  await probeConnectivity();
  await sync.syncNow({ force: true });
}

export async function retryOutboxItem(id: string): Promise<void> {
  const sync = getSyncEngine();
  if (!sync) return;
  // A user tap must send now, not wait out a session-check backoff.
  resetSessionBackoff();
  await sync.retry(id);
  await sync.syncNow();
}

export async function retryOutboxItemWithLatest(id: string): Promise<void> {
  const sync = getSyncEngine();
  if (!sync) return;
  // A user tap must send now, not wait out a session-check backoff.
  resetSessionBackoff();
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
