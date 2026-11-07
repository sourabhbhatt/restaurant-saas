/** GET /api/v1/dev/mailbox — local/test only: the latest rows of the email outbox. */
export interface DevMailboxEmailDto {
  id: string;
  to: string;
  subject: string;
  template: string;
  text: string;
  html: string | null;
  status: "PENDING" | "SENT" | "FAILED";
  provider: string | null;
  lastError: string | null;
  createdAt: string;
  sentAt: string | null;
}

export const DEV_MAILBOX_LIMIT = 50;
