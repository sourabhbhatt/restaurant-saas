import type { EmailSender } from "../interfaces/email-sender";

/**
 * Development sink: nothing is delivered. The notification service always
 * writes every email to the `email_outbox` table first, so in development the
 * message can be read in the dev mailbox (/dev/mailbox) instead.
 */
export function createOutboxEmailSender(): EmailSender {
  return {
    name: "outbox",
    delivers: false,
    async send() {
      return { provider: "outbox", messageId: null };
    },
  };
}
