"use client";

import { create } from "zustand";

import type { OutboxItem, OutboxStatus } from "./db";

export type OutboxCounts = Record<OutboxStatus, number>;

export const EMPTY_COUNTS: OutboxCounts = {
  pending: 0,
  syncing: 0,
  synced: 0,
  failed: 0,
  conflict: 0,
};

export interface SyncState {
  /** Real connectivity (navigator.onLine confirmed by GET /api/v1/sync/ping). */
  online: boolean;
  /** A sync run is in progress in this tab. */
  syncing: boolean;
  /** Signed-in user on this device (null while unknown or signed out). */
  userId: string | null;
  counts: OutboxCounts;
  /** Every outbox item of the current user, oldest first. */
  items: OutboxItem[];
  /** Unsynced items saved by a different account on this device (never sent). */
  otherUserPending: number;
  lastSyncAt: number | null;
  /** When the last successful probe/sync confirmed connectivity. */
  lastOnlineAt: number | null;
  /** Session expired while syncing: changes wait until the user signs in again. */
  authRequired: boolean;
}

export const initialSyncState: SyncState = {
  online: true,
  syncing: false,
  userId: null,
  counts: EMPTY_COUNTS,
  items: [],
  otherUserPending: 0,
  lastSyncAt: null,
  lastOnlineAt: null,
  authRequired: false,
};

export const useSyncStore = create<SyncState>()(() => initialSyncState);

export function setSyncState(patch: Partial<SyncState>): void {
  useSyncStore.setState(patch);
}

export function countItems(items: readonly OutboxItem[]): OutboxCounts {
  const counts = { ...EMPTY_COUNTS };
  for (const item of items) counts[item.status] += 1;
  return counts;
}

/** Items still waiting to reach the server (pending or in flight). */
export const waitingCount = (c: OutboxCounts) => c.pending + c.syncing;
/** Items that need the user's decision. */
export const attentionCount = (c: OutboxCounts) => c.failed + c.conflict;
