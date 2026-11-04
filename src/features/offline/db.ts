import Dexie, { type EntityTable } from "dexie";

/**
 * Per-device local database for staff devices (IndexedDB via Dexie).
 *
 * This is a cache and a queue, never shared storage: other devices never see
 * it, and the server stays the source of truth. Customer order submission,
 * order acceptance and payments are never queued here.
 */

export const OFFLINE_DB_NAME = "restaurantos-staff";

export type OutboxStatus = "pending" | "syncing" | "synced" | "failed" | "conflict";
export type OutboxMethod = "POST" | "PUT" | "PATCH" | "DELETE";

export interface OutboxItem {
  id: string;
  /** Epoch ms when the change was made on this device (FIFO order). */
  createdAt: number;
  /** Epoch ms of the last status change. */
  updatedAt: number;
  /** The user who made the change. Items are only ever sent with that user's session. */
  userId: string;
  /** Ordering unit: items with the same scope are sent strictly one after another. */
  scopeKey: string;
  /** Machine-readable kind, e.g. "menu.availability". */
  kind: string;
  /** Human readable, e.g. "Mark Paneer Tikka unavailable". */
  label: string;
  method: OutboxMethod;
  /** API path, e.g. "/branches/<id>/menu/items/<id>/availability" (prefixed with /api/v1). */
  path: string;
  body?: unknown;
  /** Sent as Idempotency-Key on every attempt (reused across retries). */
  idempotencyKey: string;
  /** Optimistic concurrency: the version the user edited. Sent as `version` in the body. */
  expectedVersion?: number;
  status: OutboxStatus;
  attempts: number;
  /** Epoch ms before which the item is not retried automatically. */
  nextAttemptAt: number;
  lastError: string | null;
  /** Stable error code from the server (e.g. STALE_VERSION) or NETWORK_ERROR. */
  lastErrorCode?: string | null;
  lastStatus?: number | null;
  /** `data` from the server on success, or the error envelope on failure/conflict. */
  serverResponse?: unknown;
  syncedAt?: number | null;
  /** TanStack query keys to invalidate after the item synced. */
  invalidateKeys?: unknown[][];
}

export interface QueryCacheRow {
  /** JSON of the query key. */
  key: string;
  queryKey: unknown[];
  data: unknown;
  /** dataUpdatedAt of the cached result (epoch ms). */
  updatedAt: number;
  userId: string;
}

export interface DraftRow {
  /** `${userId}:${draftKey}` */
  key: string;
  userId: string;
  value: unknown;
  updatedAt: number;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

export type OfflineDatabase = Dexie & {
  queryCache: EntityTable<QueryCacheRow, "key">;
  outbox: EntityTable<OutboxItem, "id">;
  drafts: EntityTable<DraftRow, "key">;
  meta: EntityTable<MetaRow, "key">;
};

export function createOfflineDb(name: string = OFFLINE_DB_NAME): OfflineDatabase {
  const db = new Dexie(name) as OfflineDatabase;
  db.version(1).stores({
    queryCache: "key, userId, updatedAt",
    outbox: "id, userId, status, scopeKey, createdAt, [userId+status]",
    drafts: "key, userId, updatedAt",
    meta: "key",
  });
  return db;
}

let shared: OfflineDatabase | null = null;

/** The device database (browser only). Returns null where IndexedDB is unavailable. */
export function getOfflineDb(): OfflineDatabase | null {
  if (typeof indexedDB === "undefined") return null;
  shared ??= createOfflineDb();
  return shared;
}

const CURRENT_USER_KEY = "currentUserId";

export async function getStoredUserId(db: OfflineDatabase): Promise<string | null> {
  const row = await db.meta.get(CURRENT_USER_KEY);
  return typeof row?.value === "string" ? row.value : null;
}

/**
 * Record who is signed in on this device. When it changes, the previous
 * user's cached server data and form drafts are deleted (privacy on shared
 * devices). Their *unsynced* outbox items are kept, but never sent with
 * another user's session and never shown in detail; the new user may discard
 * them explicitly. Returns true when the user changed.
 */
export async function switchUser(db: OfflineDatabase, userId: string): Promise<boolean> {
  return db.transaction("rw", [db.meta, db.queryCache, db.drafts, db.outbox], async () => {
    const previous = await getStoredUserId(db);
    if (previous === userId) return false;
    await db.queryCache.where("userId").notEqual(userId).delete();
    await db.drafts.where("userId").notEqual(userId).delete();
    await db.outbox.filter((item) => item.userId !== userId && item.status === "synced").delete();
    await db.meta.put({ key: CURRENT_USER_KEY, value: userId });
    return previous !== null;
  });
}
