import type { AnalyticsIds, ServerTrackingEvent } from "@ros/contracts/tracking-events";

import type { Logger } from "./observability";

/**
 * Server-authoritative growth events (GA4 Measurement Protocol behind the
 * adapter; `none` by default). Fire-and-forget: `track` returns at once,
 * never throws, and a slow or failed send never affects the operation that
 * emitted it. Callers emit only after their transaction committed and only
 * on the first transition, never for a replay, retry or duplicate delivery.
 */
export interface ServerTracking {
  readonly provider: string;
  track(event: ServerTrackingEvent, context?: ServerTrackingContext): void;
  /** Resolves once every send started so far has settled (tests, shutdown). */
  flush(): Promise<void>;
}

export interface ServerTrackingContext {
  /**
   * The GA4 ids of the browser that made the request, present only after that
   * visitor opted in (RequestMeta.analytics). Absent: an anonymous event.
   */
  analytics?: AnalyticsIds | null;
}

export const noServerTracking: ServerTracking = {
  provider: "none",
  track: () => {},
  flush: async () => {},
};

/** `track` that cannot throw into a committed business operation, whatever the adapter does. */
export function trackSafely(
  tracking: ServerTracking,
  logger: Logger | undefined,
  event: ServerTrackingEvent,
  context?: ServerTrackingContext,
): void {
  try {
    tracking.track(event, context);
  } catch {
    logger?.warn("server_tracking_failed", { event: event.name });
  }
}
