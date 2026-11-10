import { createSystemRunner } from "@ros/database/providers/postgres/client";
import { auditRepository } from "@ros/database/providers/postgres/repositories/core";
import { platformRepository } from "@ros/database/providers/postgres/repositories/platform";

import type { Container } from "./container";
import { createPlatformService } from "@ros/application/modules/platform/service";
import { sendEmail } from "@ros/application/notifications/email";

/** Per-module wiring: binds the platform module's ports to the Postgres adapters. */
export function platformService(c: Container) {
  return createPlatformService({
    // System: the Super Admin console and scheduled jobs work across workspaces.
    tx: createSystemRunner(c.db, (db) => ({
      platform: platformRepository(db),
      audit: auditRepository(db),
    })),
    clock: c.clock,
    entitlements: c.entitlements,
    appUrl: c.env.APP_URL,
    logger: c.logger,
    paymentsEnabled: c.payments !== null,
    tracking: c.tracking,
    mailer: {
      send: (to, template, subject, text) => sendEmail(c, { to, template, subject, text }),
    },
  });
}
