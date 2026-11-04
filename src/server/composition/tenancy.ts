import { createTransactionRunner } from "@/infrastructure/database/providers/postgres/client";
import { auditRepository } from "@/infrastructure/database/providers/postgres/repositories/core";
import { tenancyRepository } from "@/infrastructure/database/providers/postgres/repositories/tenancy";

import type { Container } from "../container";
import { createTenancyService } from "../modules/tenancy/service";
import { emailTemplates, sendEmail } from "../notifications/email";

/** Per-module wiring: binds the tenancy repository ports to the Postgres adapter. */
export function tenancyService(c: Container) {
  return createTenancyService({
    tx: createTransactionRunner(c.db, (db) => ({
      tenancy: tenancyRepository(db),
      audit: auditRepository(db),
    })),
    clock: c.clock,
    entitlements: c.entitlements,
    sendEmail: (message) => sendEmail(c, message),
    invitationEmail: (workspaceName, inviterName, url) =>
      emailTemplates.invitation(c.env.APP_NAME, workspaceName, inviterName, url),
    appUrl: c.env.APP_URL,
  });
}
