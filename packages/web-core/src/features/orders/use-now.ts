"use client";

import { useEffect, useState } from "react";

/** Current time, re-rendered every `intervalMs` (for elapsed timers). */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** "45s", "12m", "1h 05m" */
export function formatElapsed(fromIso: string | null | undefined, now: number): string {
  if (!fromIso) return "—";
  const secs = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

export function formatClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
