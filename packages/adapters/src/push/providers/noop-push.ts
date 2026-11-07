import type { PushSender } from "../interfaces/push-sender";

/**
 * Push disabled. A Web Push adapter needs VAPID keys and the `web-push`
 * package; see docs/provider-migration-guide.md. In-app notifications and
 * polling keep every workflow working without push.
 */
export function createNoopPushSender(): PushSender {
  return { name: "none", enabled: false, publicKey: null, send: async () => "skipped" };
}
