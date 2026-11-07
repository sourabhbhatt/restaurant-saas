"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Notification chime generated with the Web Audio API (no audio files).
 * Browsers only allow audio after a user gesture, so `needsGesture` tells the
 * UI to show an "Enable sound" control; `enable()` must run inside a click.
 * The mute toggle is remembered per device in localStorage.
 */
export function useAlertSound(storageKey: string, branchEnabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  // Consoles render only on the client (behind AuthGate), so storage can be read here.
  const [muted, setMutedState] = useState(() => {
    try {
      return window.localStorage.getItem(storageKey) === "muted";
    } catch {
      return false; // storage unavailable (private mode): default unmuted
    }
  });
  const [unlocked, setUnlocked] = useState(false);

  const setMuted = useCallback(
    (value: boolean) => {
      setMutedState(value);
      try {
        window.localStorage.setItem(storageKey, value ? "muted" : "on");
      } catch {
        // ignore
      }
    },
    [storageKey],
  );

  const ensureContext = useCallback((): AudioContext | null => {
    if (typeof window === "undefined") return null;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctxRef.current ??= new Ctor();
    return ctxRef.current;
  }, []);

  const tone = useCallback((ctx: AudioContext, freq: number, start: number, duration: number) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.05);
  }, []);

  const beep = useCallback(
    (kind: "new" | "ready" = "new") => {
      const ctx = ctxRef.current;
      if (!ctx || ctx.state !== "running") return;
      const t = ctx.currentTime;
      if (kind === "new") {
        tone(ctx, 880, t, 0.18);
        tone(ctx, 1320, t + 0.2, 0.25);
      } else {
        tone(ctx, 660, t, 0.25);
      }
    },
    [tone],
  );

  /** Call from a click handler: resumes audio and plays a short confirmation. */
  const enable = useCallback(async () => {
    const ctx = ensureContext();
    if (!ctx) return;
    try {
      await ctx.resume();
      setUnlocked(ctx.state === "running");
      setMuted(false);
      beep("ready");
    } catch {
      setUnlocked(false);
    }
  }, [beep, ensureContext, setMuted]);

  useEffect(() => {
    return () => {
      void ctxRef.current?.close().catch(() => {});
      ctxRef.current = null;
    };
  }, []);

  const active = branchEnabled && !muted && unlocked;
  const play = useCallback(
    (kind: "new" | "ready" = "new") => {
      if (active) beep(kind);
    },
    [active, beep],
  );

  return {
    /** Branch setting allows sound at all. */
    branchEnabled,
    muted,
    setMuted,
    /** Audio still needs a user gesture before it can play. */
    needsGesture: branchEnabled && !muted && !unlocked,
    enable,
    play,
  };
}

/**
 * Track ids seen in successive data snapshots and report the new ones. The
 * first snapshot only primes the set (no alert for orders already waiting).
 */
export function useNewIds(ids: readonly string[] | undefined, onNew: (ids: string[]) => void) {
  const seen = useRef<Set<string> | null>(null);
  const onNewRef = useRef(onNew);
  useEffect(() => {
    onNewRef.current = onNew;
  }, [onNew]);
  const key = ids?.join(",");
  useEffect(() => {
    if (!ids) return;
    if (seen.current === null) {
      seen.current = new Set(ids);
      return;
    }
    const fresh = ids.filter((id) => !seen.current!.has(id));
    for (const id of ids) seen.current.add(id);
    if (fresh.length) onNewRef.current(fresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
