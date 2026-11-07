"use client";

import { useEffect, useState } from "react";

import { getOfflineDb, getStoredUserId } from "../db";

/**
 * Reads the outbox directly from IndexedDB (works on the static offline
 * fallback page, where the sync runtime may not be running).
 */
export function PendingChangesSummary() {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    const db = getOfflineDb();
    if (!db) return;
    let cancelled = false;
    void (async () => {
      try {
        const userId = await getStoredUserId(db);
        if (!userId) return;
        const n = await db.outbox
          .where("userId")
          .equals(userId)
          .filter((i) => i.status !== "synced")
          .count();
        if (!cancelled) setCount(n);
      } catch {
        // IndexedDB blocked: say nothing rather than guess.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (count === null) return null;
  return (
    <p className="rounded-lg border bg-card px-4 py-3 text-sm" role="status">
      {count === 0 ? (
        "No unsynced changes on this device."
      ) : (
        <>
          <strong className="tabular-nums">{count}</strong>{" "}
          {count === 1 ? "change is" : "changes are"} saved on this device and will sync
          automatically when you&apos;re back online.
        </>
      )}
    </p>
  );
}
