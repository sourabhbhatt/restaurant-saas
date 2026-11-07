import type { RealtimeBus, RealtimeChannel, RealtimeEvent } from "../interfaces/realtime";

/**
 * In-process event bus feeding the Server-Sent Events endpoint. Works on a
 * single long-running Node server. With several instances or serverless hosts,
 * swap for a hosted adapter (Ably/Pusher) or Postgres LISTEN/NOTIFY; clients
 * keep working meanwhile through polling.
 */
export function createMemoryBus(): RealtimeBus {
  const listeners = new Map<string, Set<(event: RealtimeEvent) => void>>();
  return {
    name: "memory",
    async publish(channel, event) {
      const full: RealtimeEvent = { ...event, at: new Date().toISOString() };
      for (const listener of listeners.get(channel) ?? []) {
        try {
          listener(full);
        } catch {
          // A broken listener (closed stream) must not affect publishers.
        }
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
  };
}

export function createNoopBus(): RealtimeBus {
  return { name: "none", async publish() {}, subscribe: () => () => {} };
}
