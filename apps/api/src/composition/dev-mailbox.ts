import { devMailboxRepository } from "@ros/database/providers/postgres/repositories/dev-mailbox";

import type { Container } from "./container";

/** Dev mailbox wiring (local/test only). */
export function devMailbox(c: Container) {
  return {
    /** Only with ENABLE_TEST_HOOKS; it holds every account's reset and invite links. */
    enabled: c.env.ENABLE_TEST_HOOKS,
    // System: local/test only; reads the email outbox, which has no tenant column.
    repository: devMailboxRepository(c.db),
  };
}
