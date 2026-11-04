import { desc } from "drizzle-orm";

import type { DevMailboxEmailDto } from "@/contracts/dev-mailbox";

import type { Executor } from "../client";
import { emailOutbox } from "../schema";

/**
 * Read-only view of the email outbox for the local dev mailbox. Only reachable
 * through GET /api/v1/dev/mailbox, which is disabled outside development/test hooks.
 */
export interface DevMailboxRepository {
  latest(limit: number): Promise<DevMailboxEmailDto[]>;
}

export function devMailboxRepository(db: Executor): DevMailboxRepository {
  return {
    async latest(limit) {
      const rows = await db
        .select()
        .from(emailOutbox)
        .orderBy(desc(emailOutbox.createdAt), desc(emailOutbox.id))
        .limit(limit);
      return rows.map((r) => ({
        id: r.id,
        to: r.toAddress,
        subject: r.subject,
        template: r.template,
        text: r.textBody,
        html: r.htmlBody,
        status: r.status,
        provider: r.provider,
        lastError: r.lastError,
        createdAt: r.createdAt.toISOString(),
        sentAt: r.sentAt?.toISOString() ?? null,
      }));
    },
  };
}
