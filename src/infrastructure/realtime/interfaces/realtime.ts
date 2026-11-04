/**
 * Realtime port. Realtime is only a "something changed, refetch" signal: the
 * database stays the source of truth and every client also polls, so a missed
 * message never loses data.
 */
export interface RealtimeEvent {
  /** e.g. "order.created", "order.updated", "bill.updated", "table.updated" */
  type: string;
  /** Safe identifiers only; clients refetch details through authorized APIs. */
  data: Record<string, string | number | null>;
  at: string;
}

export type RealtimeChannel =
  `branch:${string}` | `session:${string}` | `user:${string}` | "platform";

export interface RealtimePublisher {
  publish(channel: RealtimeChannel, event: Omit<RealtimeEvent, "at">): Promise<void>;
}

export interface RealtimeSubscriber {
  subscribe(channel: RealtimeChannel, listener: (event: RealtimeEvent) => void): () => void;
}

export type RealtimeBus = RealtimePublisher & RealtimeSubscriber & { readonly name: string };
