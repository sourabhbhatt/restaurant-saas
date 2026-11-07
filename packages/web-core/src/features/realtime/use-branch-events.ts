"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { API_BASE } from "@ros/api-client";

import { staffOpsKeys } from "../orders/keys";

export type RealtimeStatus = "connecting" | "live" | "reconnecting" | "unsupported";

/** Event names the server may send; anything else still arrives via polling. */
export const BRANCH_EVENT_TYPES = [
  "order.created",
  "order.updated",
  "order.accepted",
  "order.rejected",
  "order.ready",
  "order.served",
  "order.cancelled",
  "session.opened",
  "session.updated",
  "session.bill_requested",
  "session.closed",
  "bill.created",
  "bill.updated",
  "bill.paid",
  "bill.voided",
  "payment.recorded",
  "table.updated",
] as const;

/** Poll intervals: realtime is only a hint, so data is always polled as well. */
export const POLL_WHEN_LIVE_MS = 10_000;
export const POLL_WHEN_OFFLINE_MS = 4_000;

const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

export interface BranchEventsState {
  status: RealtimeStatus;
  /** refetchInterval for branch queries (shorter while realtime is down). */
  pollInterval: number;
  lastEventAt: number | null;
}

/**
 * Subscribe to `/branches/:id/events` (SSE) with exponential reconnect. Any
 * event invalidates the branch's staff-ops queries so screens refetch through
 * the authorized APIs. Pair with `pollInterval` on every query so the app keeps
 * working without SSE (proxies, serverless hosts, flaky networks).
 */
export function useBranchEvents(
  branchId: string | undefined,
  options: { onEvent?: (type: string, data: Record<string, unknown>) => void } = {},
): BranchEventsState {
  const qc = useQueryClient();
  const [status, setStatus] = useState<RealtimeStatus>(() =>
    typeof EventSource === "undefined" ? "unsupported" : "connecting",
  );
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const onEventRef = useRef(options.onEvent);
  useEffect(() => {
    onEventRef.current = options.onEvent;
  }, [options.onEvent]);

  useEffect(() => {
    if (!branchId) return;
    if (typeof window === "undefined" || typeof EventSource === "undefined") return;
    let source: EventSource | null = null;
    let attempt = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const handle = (type: string) => (e: MessageEvent<string>) => {
      setLastEventAt(Date.now());
      let data: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(e.data) as { data?: Record<string, unknown> };
        data = parsed.data ?? {};
      } catch {
        // malformed payload: still treat as a refetch hint
      }
      void qc.invalidateQueries({ queryKey: staffOpsKeys.branch(branchId) });
      onEventRef.current?.(type, data);
    };

    const connect = () => {
      if (disposed) return;
      source = new EventSource(`${API_BASE}/branches/${branchId}/events`, {
        withCredentials: true,
      });
      source.addEventListener("ready", () => {
        attempt = 0;
        setStatus("live");
      });
      for (const type of BRANCH_EVENT_TYPES) source.addEventListener(type, handle(type));
      source.onmessage = handle("message");
      source.onerror = () => {
        // Close and retry ourselves with backoff (also covers 401/403/404,
        // which EventSource would otherwise give up on silently).
        source?.close();
        source = null;
        if (disposed) return;
        setStatus("reconnecting");
        const delay = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * 2 ** attempt);
        attempt += 1;
        timer = setTimeout(connect, delay + Math.floor(Math.random() * 500));
      };
    };

    connect();
    const onOnline = () => {
      if (source) return;
      if (timer) clearTimeout(timer);
      attempt = 0;
      connect();
    };
    window.addEventListener("online", onOnline);
    return () => {
      disposed = true;
      window.removeEventListener("online", onOnline);
      if (timer) clearTimeout(timer);
      source?.close();
    };
  }, [branchId, qc]);

  return {
    status,
    pollInterval: status === "live" ? POLL_WHEN_LIVE_MS : POLL_WHEN_OFFLINE_MS,
    lastEventAt,
  };
}
