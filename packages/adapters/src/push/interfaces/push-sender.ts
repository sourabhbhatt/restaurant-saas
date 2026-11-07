/** Browser push port (Web Push / VAPID). Push is optional: the app works without it. */
export interface PushTarget {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushPayload {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
}

export interface PushSender {
  readonly name: string;
  readonly enabled: boolean;
  readonly publicKey: string | null;
  /** Returns "gone" when the subscription expired and should be deleted. */
  send(target: PushTarget, payload: PushPayload): Promise<"sent" | "gone" | "skipped">;
}
