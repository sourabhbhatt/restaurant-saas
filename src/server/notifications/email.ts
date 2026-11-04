import type { EmailMessage } from "@/infrastructure/email/interfaces/email-sender";

import type { Container } from "../container";

/**
 * Send an email through the configured provider. Every message is written to
 * the outbox first, so failures are visible and retryable, and the dev
 * mailbox can show messages when no provider is configured. Email is never
 * on the critical path: delivery failures are logged, not thrown.
 */
export async function sendEmail(
  c: Pick<Container, "repos" | "email" | "logger">,
  message: EmailMessage,
): Promise<void> {
  const id = await c.repos.emailOutbox.enqueue({
    to: message.to,
    subject: message.subject,
    template: message.template,
    text: message.text,
    html: message.html ?? null,
    provider: c.email.name,
    delivered: c.email.delivers,
  });
  if (!c.email.delivers) return;
  try {
    const result = await c.email.send(message);
    await c.repos.emailOutbox.markSent(id, result.messageId);
  } catch (error) {
    c.logger.warn("email_send_failed", { template: message.template, outboxId: id, error });
    await c.repos.emailOutbox.markFailed(id, error instanceof Error ? error.message : "unknown");
  }
}

export const emailTemplates = {
  verifyEmail(appName: string, url: string): Omit<EmailMessage, "to"> {
    return {
      template: "verify_email",
      subject: `Verify your ${appName} email`,
      text: `Welcome to ${appName}!\n\nConfirm your email address by opening this link:\n${url}\n\nThe link expires in 48 hours.`,
    };
  },
  resetPassword(appName: string, url: string): Omit<EmailMessage, "to"> {
    return {
      template: "reset_password",
      subject: `Reset your ${appName} password`,
      text: `We received a request to reset your password.\n\nOpen this link to choose a new one:\n${url}\n\nThe link expires in 1 hour. If you did not request this, ignore this email; your password is unchanged.`,
    };
  },
  invitation(
    appName: string,
    workspaceName: string,
    inviterName: string,
    url: string,
  ): Omit<EmailMessage, "to"> {
    return {
      template: "workspace_invitation",
      subject: `${inviterName} invited you to ${workspaceName} on ${appName}`,
      text: `${inviterName} invited you to join ${workspaceName} on ${appName}.\n\nAccept the invitation:\n${url}\n\nThe invitation expires in 7 days.`,
    };
  },
  generic(template: string, subject: string, text: string): Omit<EmailMessage, "to"> {
    return { template, subject, text };
  },
};
