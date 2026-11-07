import {
  createSystemRunner,
  type Executor,
} from "@/infrastructure/database/providers/postgres/client";
import { auditRepository } from "@/infrastructure/database/providers/postgres/repositories/core";
import { notificationCenterRepository } from "@/infrastructure/database/providers/postgres/repositories/notification-center";

import type { Container } from "../container";
import { tenantRunner } from "./runners";
import { createNotificationService } from "../modules/notifications/service";

/** Per-module wiring: binds the notification center ports to the Postgres adapter. */
export function notificationService(c: Container) {
  const build = (e: Executor) => ({
    notifications: notificationCenterRepository(e),
    audit: auditRepository(e),
  });
  return createNotificationService({
    tx: tenantRunner(c, build),
    // System: the actor's own notifications and preferences; every write filters by actor.userId.
    account: createSystemRunner(c.db, build),
    clock: c.clock,
    push: { enabled: c.push.enabled, publicKey: c.push.publicKey },
  });
}
