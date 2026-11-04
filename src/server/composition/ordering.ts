import { createTransactionRunner } from "@/infrastructure/database/providers/postgres/client";
import { auditRepository } from "@/infrastructure/database/providers/postgres/repositories/core";
import { orderingRepository } from "@/infrastructure/database/providers/postgres/repositories/ordering";

import type { Container } from "../container";
import { createOrderingService } from "../modules/ordering/service";

/** Per-module wiring for customer (QR) ordering and staff order placement. */
export function orderingService(c: Container) {
  const imageUrl = (key: string) => c.storage.url(key);
  return createOrderingService({
    tx: createTransactionRunner(c.db, (db) => ({
      ordering: orderingRepository(db, { imageUrl }),
      audit: auditRepository(db),
    })),
    clock: c.clock,
    entitlements: c.entitlements,
    realtime: c.realtime,
    rateLimit: c.repos.rateLimit,
    fileUrl: imageUrl,
    logger: c.logger,
  });
}
