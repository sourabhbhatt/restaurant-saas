import type { ServerTracking, ServerTrackingContext } from "@ros/application/ports/server-tracking";
import { validateTrackingEvent, type ServerTrackingEvent } from "@ros/contracts/tracking-events";

export interface RecordedServerEvent {
  event: ServerTrackingEvent;
  context: ServerTrackingContext;
}

export interface MemoryServerTracking extends ServerTracking {
  /** Events that passed the catalog check (what the GA4 adapter would send). */
  readonly events: RecordedServerEvent[];
  /** Events the catalog check refused, with the reason. */
  readonly rejected: { name: string; reason: string }[];
  clear(): void;
}

/** Records events in memory (tests). Nothing leaves the process. */
export function createMemoryServerTracking(): MemoryServerTracking {
  const events: RecordedServerEvent[] = [];
  const rejected: { name: string; reason: string }[] = [];
  return {
    provider: "memory",
    events,
    rejected,
    track(event, context) {
      if (!context?.analytics?.clientId) {
        rejected.push({ name: event.name, reason: "no_consent" });
        return;
      }
      const checked = validateTrackingEvent("server", event.name, event.params);
      if (checked.ok) events.push({ event, context });
      else rejected.push({ name: event.name, reason: checked.reason });
    },
    flush: async () => {},
    clear() {
      events.length = 0;
      rejected.length = 0;
    },
  };
}
