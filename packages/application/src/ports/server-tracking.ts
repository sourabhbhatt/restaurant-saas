import type { AnalyticsIds, ServerTrackingEvent } from "@ros/contracts/tracking-events";

import type { Logger } from "./observability";

/**
 * Server-authoritative growth events (GA4 Measurement Protocol behind the
 * adapter; `none` by default). Fire-and-forget: `track` returns at once,
 * never throws, and a slow or failed send never affects the operation that
 * emitted it. Callers emit only after their transaction committed and only
 * on the first transition, never for a replay, retry or duplicate delivery.
 *
 * Privacy rule: an event is sent only for a person who opted in to
 * analytics, so every event carries that person's GA4 ids. There are no
 * anonymous server events; adapters refuse one without ids.
 */
export interface ServerTracking {
  readonly provider: string;
  track(event: ServerTrackingEvent, context: ServerTrackingContext): void;
  /** Resolves once every send started so far has settled (tests, shutdown). */
  flush(): Promise<void>;
}

export interface ServerTrackingContext {
  /**
   * The GA4 ids of the person the event is about, present only because they
   * opted in: the requesting browser's (RequestMeta.analytics) or the ones
   * stored with their checkout (a payment webhook).
   */
  analytics: AnalyticsIds;
}

export const noServerTracking: ServerTracking = {
  provider: "none",
  track: () => {},
  flush: async () => {},
};

/**
 * `track` for a committed business operation: sends nothing unless the person
 * opted in (`analytics` present), and cannot throw whatever the adapter does.
 */
export function trackSafely(
  tracking: ServerTracking,
  logger: Logger | undefined,
  event: ServerTrackingEvent,
  analytics: AnalyticsIds | null | undefined,
): void {
  if (!analytics) return;
  try {
    tracking.track(event, { analytics });
  } catch {
    logger?.warn("server_tracking_failed", { event: event.name });
  }
}
