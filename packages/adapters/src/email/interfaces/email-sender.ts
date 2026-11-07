/** Email port. Adapters: outbox (dev, stores in DB only), resend, brevo (HTTP APIs). */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Template id for logging/analytics; never contains personal data. */
  template: string;
}

export interface EmailSendResult {
  provider: string;
  messageId: string | null;
}

export interface EmailSender {
  readonly name: string;
  /** Returns false when the provider is a dev sink that does not deliver. */
  readonly delivers: boolean;
  send(message: EmailMessage): Promise<EmailSendResult>;
}
