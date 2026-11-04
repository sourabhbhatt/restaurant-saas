"use client";

import { useEffect, useState } from "react";

import { StatusBadge, type StatusTone } from "@/components/shared/feedback";
import { cn } from "@/lib/utils";

import type { RealtimeStatus } from "./use-branch-events";

const LABEL: Record<RealtimeStatus, string> = {
  live: "Live",
  connecting: "Connecting…",
  reconnecting: "Polling",
  unsupported: "Polling",
};

const TONE: Record<RealtimeStatus, StatusTone> = {
  live: "success",
  connecting: "neutral",
  reconnecting: "warning",
  unsupported: "warning",
};

function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function useSecondsSince(at: number | undefined): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);
  if (!at) return null;
  return Math.max(0, Math.round((now - at) / 1000));
}

/**
 * Realtime + sync indicator: "Live" while the SSE stream is open, "Polling"
 * when it is down (data still refreshes), "Offline" without a network, plus
 * how long ago data was last synced.
 */
export function ConnectionStatus({
  status,
  lastSyncedAt,
  className,
}: {
  status: RealtimeStatus;
  /** `dataUpdatedAt` of the screen's main query. */
  lastSyncedAt?: number;
  className?: string;
}) {
  const online = useOnline();
  const seconds = useSecondsSince(lastSyncedAt);
  const tone: StatusTone = online ? TONE[status] : "danger";
  const label = online ? LABEL[status] : "Offline";
  const synced =
    seconds === null ? null : seconds < 10 ? "just now" : seconds < 120 ? `${seconds}s ago` : `${Math.round(seconds / 60)}m ago`;
  return (
    <div
      className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}
      role="status"
      aria-live="polite"
    >
      <StatusBadge tone={tone} dot pulse={online && status === "live"}>
        {label}
      </StatusBadge>
      {synced && <span className="hidden sm:inline">Synced {synced}</span>}
    </div>
  );
}
