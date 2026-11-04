import { devMailboxRepository } from "@/infrastructure/database/providers/postgres/repositories/dev-mailbox";

import type { Container } from "../container";

/** Dev mailbox wiring (local/test only). */
export function devMailbox(c: Container) {
  return {
    /** True only in development or when test hooks are explicitly enabled. */
    enabled: c.env.ENABLE_TEST_HOOKS || c.env.NODE_ENV === "development",
    repository: devMailboxRepository(c.db),
  };
}
