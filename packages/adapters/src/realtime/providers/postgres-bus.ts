import pg from "pg";

import type { Logger } from "@ros/application/ports/observability";

import type { RealtimeBus, RealtimeChannel, RealtimeEvent } from "../interfaces/realtime";

const PG_CHANNEL = "ros_realtime";
/** NOTIFY payloads are capped at 8000 bytes by Postgres. */
const MAX_PAYLOAD_BYTES = 7900;
const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30_000;

export const nextBackoffMs = (current: number) => Math.min(current * 2, MAX_BACKOFF_MS);

/**
 * Multi-instance realtime over Postgres LISTEN/NOTIFY. Every delivery,
 * including to the publishing instance, goes through NOTIFY (one path, no
 * double delivery; clients also poll) so each event
 * arrives exactly once per subscriber. Events are only "refetch" hints, so a
 * dropped or missed notification is covered by client polling.
 */
export function createPostgresBus(cfg: {
  connectionString: string;
  logger: Logger;
}): RealtimeBus & { close(): Promise<void>; ready: Promise<void> } {
  const { logger } = cfg;
  const listeners = new Map<string, Set<(event: RealtimeEvent) => void>>();
  const publisher = new pg.Pool({ connectionString: cfg.connectionString, max: 2 });
  publisher.on("error", (error) => logger.warn("realtime_pool_error", { error: error.message }));

  let client: pg.Client | null = null;
  let closed = false;
  let backoff = MIN_BACKOFF_MS;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let reconnecting = false;

  const dispatch = (raw: string | undefined) => {
    if (!raw) return;
    let parsed: { c: string; e: RealtimeEvent };
    try {
      parsed = JSON.parse(raw);
    } catch {
      logger.warn("realtime_bad_payload");
      return;
    }
    for (const listener of listeners.get(parsed.c) ?? []) {
      try {
        listener(parsed.e);
      } catch {
        // A broken listener (closed stream) must not affect other listeners.
      }
    }
  };

  const scheduleReconnect = () => {
    if (closed || retry) return;
    reconnecting = true;
    retry = setTimeout(() => {
      retry = null;
      void connect();
    }, backoff);
    retry.unref?.();
    backoff = nextBackoffMs(backoff);
  };

  const connect = async () => {
    const next = new pg.Client({ connectionString: cfg.connectionString });
    next.on("error", (error) => {
      logger.warn("realtime_connection_error", { error: error.message });
      next.removeAllListeners();
      next.on("error", () => {});
      void next.end().catch(() => {});
      if (client === next) client = null;
      scheduleReconnect();
    });
    next.on("notification", (msg) => dispatch(msg.payload));
    try {
      await next.connect();
      await next.query(`LISTEN ${PG_CHANNEL}`);
    } catch (error) {
      next.removeAllListeners();
      next.on("error", () => {});
      void next.end().catch(() => {});
      logger.warn("realtime_connect_failed", { error: (error as Error).message });
      scheduleReconnect();
      return;
    }
    if (closed) {
      void next.end().catch(() => {});
      return;
    }
    client = next;
    backoff = MIN_BACKOFF_MS;
    if (reconnecting) logger.info("realtime_reconnected");
    reconnecting = false;
  };

  const ready = connect();

  return {
    name: "postgres",
    ready,
    async publish(channel, event) {
      const payload = JSON.stringify({
        c: channel,
        e: { ...event, at: new Date().toISOString() },
      });
      const bytes = Buffer.byteLength(payload);
      if (bytes > MAX_PAYLOAD_BYTES) {
        logger.warn("realtime_payload_too_large", { channel, type: event.type, bytes });
        return;
      }
      try {
        await publisher.query("select pg_notify($1, $2)", [PG_CHANNEL, payload]);
      } catch (error) {
        // Realtime is best-effort; clients poll as a fallback.
        logger.warn("realtime_publish_failed", { error: (error as Error).message });
      }
    },
    subscribe(channel: RealtimeChannel, listener) {
      let set = listeners.get(channel);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
      }
      set.add(listener);
      return () => {
        set.delete(listener);
        if (set.size === 0) listeners.delete(channel);
      };
    },
    async close() {
      closed = true;
      if (retry) clearTimeout(retry);
      await ready.catch(() => {});
      const current = client;
      client = null;
      await current?.end().catch(() => {});
      await publisher.end().catch(() => {});
    },
  };
}
