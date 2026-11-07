import { createSystemRunner } from "@/infrastructure/database/providers/postgres/client";
import { auditRepository } from "@/infrastructure/database/providers/postgres/repositories/core";
import { platformRepository } from "@/infrastructure/database/providers/postgres/repositories/platform";

import type { Container } from "../container";
import { createPlatformService } from "../modules/platform/service";
import { sendEmail } from "../notifications/email";

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
    mailer: {
      send: (to, template, subject, text) => sendEmail(c, { to, template, subject, text }),
    },
  });
}
