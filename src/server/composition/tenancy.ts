import {
  createSystemLookup,
  createSystemRunner,
  type Executor,
} from "@/infrastructure/database/providers/postgres/client";
import { auditRepository } from "@/infrastructure/database/providers/postgres/repositories/core";
import { tenancyRepository } from "@/infrastructure/database/providers/postgres/repositories/tenancy";

import type { Container } from "../container";
import { tenantRunner } from "./runners";
import { createTenancyService } from "../modules/tenancy/service";
import { emailTemplates, sendEmail } from "../notifications/email";

/** Per-module wiring: binds the tenancy repository ports to the Postgres adapter. */
export function tenancyService(c: Container) {
  const build = (e: Executor) => ({
    tenancy: tenancyRepository(e),
    audit: auditRepository(e),
  });
  return createTenancyService({
    tx: tenantRunner(c, build),
    // System: an invitation token is how the invitee's request learns the workspace.
    lookup: createSystemLookup(c.db, tenancyRepository, ["findInvitationByTokenHash"]),
    // System: writes with no workspace (own profile + audit; the invitee's in-app notice).
    account: createSystemRunner(c.db, build),
    clock: c.clock,
    entitlements: c.entitlements,
    sendEmail: (message) => sendEmail(c, message),
    invitationEmail: (workspaceName, inviterName, url) =>
      emailTemplates.invitation(c.env.APP_NAME, workspaceName, inviterName, url),
    appUrl: c.env.APP_URL,
    logger: c.logger,
  });
}
