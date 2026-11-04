"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { getOfflineDb } from "./db";
import { useSyncStore } from "./sync-store";

const SAVE_DEBOUNCE_MS = 400;

export interface OfflineDraft<T> {
  value: T;
  /** Update the draft; it is saved on this device shortly after. */
  setValue: (next: T | ((previous: T) => T)) => void;
  /** Delete the saved draft (e.g. after a successful submit) and reset to `initial`. */
  clear: () => Promise<void>;
  /** True when a previously saved draft was loaded. */
  restored: boolean;
  /** When the draft was last saved locally (epoch ms). */
  savedAt: number | null;
  /** The saved draft (if any) has been read. */
  ready: boolean;
}

/**
 * Persist a form draft locally (per device and per signed-in user) so work
 * survives reloads and connection loss. Drafts never reach the server by
 * themselves; submit them normally (or with `enqueueMutation` for
 * draft-able operations).
 */
export function useOfflineDraft<T>(key: string, initial: T): OfflineDraft<T> {
  const userId = useSyncStore((s) => s.userId);
  const [value, setState] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const initialRef = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storageKey = userId ? `${userId}:${key}` : null;

  useEffect(() => {
    const db = getOfflineDb();
    if (!db || !storageKey) return;
    let cancelled = false;
    db.drafts
      .get(storageKey)
      .then((row) => {
        if (cancelled) return;
        if (row) {
          setState(row.value as T);
          setRestored(true);
          setSavedAt(row.updatedAt);
        }
        setLoadedFor(storageKey);
      })
      .catch(() => {
        if (!cancelled) setLoadedFor(storageKey);
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const setValue = useCallback(
    (next: T | ((previous: T) => T)) => {
      setState((previous) => {
        const resolved =
          typeof next === "function" ? (next as (p: T) => T)(previous) : (next as T);
        const db = getOfflineDb();
        if (db && storageKey && userId) {
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            const at = Date.now();
            db.drafts
              .put({ key: storageKey, userId, value: resolved, updatedAt: at })
              .then(() => setSavedAt(at))
              .catch(() => {
                // Best-effort: the in-memory value is still there.
              });
          }, SAVE_DEBOUNCE_MS);
        }
        return resolved;
      });
    },
    [storageKey, userId],
  );

  const clear = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    setState(initialRef.current);
    setRestored(false);
    setSavedAt(null);
    const db = getOfflineDb();
    if (db && storageKey) await db.drafts.delete(storageKey).catch(() => {});
  }, [storageKey]);

  return {
    value,
    setValue,
    clear,
    restored,
    savedAt,
    ready: !storageKey || loadedFor === storageKey,
  };
}
