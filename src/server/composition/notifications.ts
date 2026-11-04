import { createTransactionRunner } from "@/infrastructure/database/providers/postgres/client";
import { auditRepository } from "@/infrastructure/database/providers/postgres/repositories/core";
import { notificationCenterRepository } from "@/infrastructure/database/providers/postgres/repositories/notification-center";

import type { Container } from "../container";
import { createNotificationService } from "../modules/notifications/service";

/** Per-module wiring: binds the notification center ports to the Postgres adapter. */
export function notificationService(c: Container) {
  return createNotificationService({
    tx: createTransactionRunner(c.db, (db) => ({
      notifications: notificationCenterRepository(db),
      audit: auditRepository(db),
    })),
    clock: c.clock,
    push: { enabled: c.push.enabled, publicKey: c.push.publicKey },
  });
}
