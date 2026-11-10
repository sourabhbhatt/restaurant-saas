import type { Logger } from "@ros/application/ports/observability";
import type { ServerTracking } from "@ros/application/ports/server-tracking";
import { validateTrackingEvent } from "@ros/contracts/tracking-events";

export interface Ga4MeasurementProtocolConfig {
  /** The console's GA4 web stream (`G-…`), so server events join the browser's data. */
  measurementId: string;
  /** Measurement Protocol API secret of that stream. Server-side only; never logged. */
  apiSecret: string;
  logger: Logger;
  /** Default 2000 ms. The business operation never waits for it. */
  timeoutMs?: number;
  /** Default https://www.google-analytics.com/mp/collect (EU: region1.google-analytics.com). */
  endpoint?: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

const DEFAULT_ENDPOINT = "https://www.google-analytics.com/mp/collect";

/**
 * GA4 Measurement Protocol sender. Every event is checked against the shared
 * catalog first and must carry the GA4 client id of a person who opted in
 * (there are no anonymous server events); the request carries no user id,
 * no user data, no IP and ad consent DENIED. Measurement Protocol answers 2xx even for a malformed
 * payload, so a non-2xx is an HTTP-level problem worth a warning.
 */
export function createGa4MeasurementProtocolTracking(
  config: Ga4MeasurementProtocolConfig,
): ServerTracking {
  const doFetch = config.fetch ?? fetch;
  const now = config.now ?? (() => new Date());
  const timeoutMs = config.timeoutMs ?? 2000;
  const url = new URL(config.endpoint ?? DEFAULT_ENDPOINT);
  url.searchParams.set("measurement_id", config.measurementId);
  url.searchParams.set("api_secret", config.apiSecret);
  const pending = new Set<Promise<void>>();

  async function send(name: string, body: unknown): Promise<void> {
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok)
        config.logger.warn("server_tracking_send_failed", { event: name, status: res.status });
      await res.body?.cancel();
    } catch (error) {
      const reason =
        error instanceof DOMException &&
        (error.name === "TimeoutError" || error.name === "AbortError")
          ? "timeout"
          : "network";
      // Never the URL (it carries the API secret) and never the payload.
      config.logger.warn("server_tracking_send_failed", { event: name, reason });
    }
  }

  return {
    provider: "ga4",
    track(event, context) {
      try {
        const checked = validateTrackingEvent("server", event.name, event.params);
        if (!checked.ok) {
          config.logger.warn("server_tracking_event_rejected", {
            event: event.name,
            reason: checked.reason,
          });
          return;
        }
        const ids = context?.analytics;
        if (!ids?.clientId) {
          config.logger.warn("server_tracking_event_rejected", {
            event: event.name,
            reason: "no_consent",
          });
          return;
        }
        const at = now();
        const params: Record<string, string | number | boolean> = {
          ...checked.params,
          content_group: "product",
        };
        if (ids.sessionId) {
          params.session_id = ids.sessionId;
          // GA4 places an event in a session only with an engagement time (MP reference).
          params.engagement_time_msec = 1;
        }
        const body = {
          client_id: ids.clientId,
          timestamp_micros: at.getTime() * 1000,
          consent: { ad_user_data: "DENIED", ad_personalization: "DENIED" },
          events: [{ name: event.name, params }],
        };
        const p = send(event.name, body).finally(() => pending.delete(p));
        pending.add(p);
      } catch (error) {
        config.logger.warn("server_tracking_send_failed", {
          event: event.name,
          reason: error instanceof Error ? error.name : "unknown",
        });
      }
    },
    async flush() {
      await Promise.all([...pending]);
    },
  };
}
