import type { EmailMessage, EmailSender } from "../interfaces/email-sender";

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Provider error bodies can echo addresses; keep only the status.
    throw new Error(`Email provider responded with HTTP ${res.status}`);
  }
  return res.json().catch(() => ({}));
}

function parseFrom(from: string): { name?: string; email: string } {
  const match = /^(.*)<(.+)>$/.exec(from.trim());
  return match ? { name: match[1]!.trim(), email: match[2]!.trim() } : { email: from.trim() };
}

/** Resend (https://resend.com/docs/api-reference/emails/send-email). Requires a verified domain. */
export function createResendEmailSender(apiKey: string, from: string): EmailSender {
  return {
    name: "resend",
    delivers: true,
    async send(m: EmailMessage) {
      const data = (await postJson(
        "https://api.resend.com/emails",
        { authorization: `Bearer ${apiKey}` },
        { from, to: [m.to], subject: m.subject, text: m.text, html: m.html },
      )) as { id?: string };
      return { provider: "resend", messageId: data.id ?? null };
    },
  };
}

/** Brevo transactional email (https://developers.brevo.com/reference/sendtransacemail). */
export function createBrevoEmailSender(apiKey: string, from: string): EmailSender {
  return {
    name: "brevo",
    delivers: true,
    async send(m: EmailMessage) {
      const data = (await postJson(
        "https://api.brevo.com/v3/smtp/email",
        { "api-key": apiKey },
        {
          sender: parseFrom(from),
          to: [{ email: m.to }],
          subject: m.subject,
          textContent: m.text,
          htmlContent: m.html ?? `<pre>${m.text.replace(/[<>&]/g, "")}</pre>`,
        },
      )) as { messageId?: string };
      return { provider: "brevo", messageId: data.messageId ?? null };
    },
  };
}
