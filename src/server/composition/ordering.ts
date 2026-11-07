import {
  createSystemLookup,
  type Executor,
} from "@/infrastructure/database/providers/postgres/client";
import { auditRepository } from "@/infrastructure/database/providers/postgres/repositories/core";
import { orderingRepository } from "@/infrastructure/database/providers/postgres/repositories/ordering";

import type { Container } from "../container";
import { createOrderingService } from "../modules/ordering/service";
import { tenantRunner } from "./runners";

/** Per-module wiring for customer (QR) ordering and staff order placement. */
export function orderingService(c: Container) {
  const imageUrl = (key: string) => c.storage.url(key);
  const build = (e: Executor) => ({
    ordering: orderingRepository(e, { imageUrl }),
    audit: auditRepository(e),
  });
  return createOrderingService({
    tx: tenantRunner(c, build),
    // System: a QR or guest token is how a guest request learns its workspace.
    lookup: createSystemLookup(c.db, (e) => orderingRepository(e, { imageUrl }), [
      "findTableByQrHash",
      "findGuestByTokenHash",
    ]),
    clock: c.clock,
    entitlements: c.entitlements,
    realtime: c.realtime,
    rateLimit: c.repos.rateLimit,
    fileUrl: imageUrl,
    logger: c.logger,
  });
}
