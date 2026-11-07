import type { TransactionRunner } from "@/infrastructure/database/interfaces/transaction";

import type { Clock, Logger } from "../../ports/observability";
import type { EntitlementService } from "../../subscriptions/entitlement-service";
import type { TenancyRepos } from "./ports";

export interface TenancyMail {
  to: string;
  subject: string;
  template: string;
  text: string;
  html?: string;
}

export interface TenancyServiceDeps {
  tx: TransactionRunner<TenancyRepos>;
  /** Owner-level lookup that resolves an invitation token to its workspace. */
  lookup: Pick<TenancyRepos["tenancy"], "findInvitationByTokenHash">;
  /**
   * Owner-level runner for writes outside the bound workspace: the actor's own
   * profile, and the workspace-less notification to an invited existing user.
   */
  account: TransactionRunner<{
    tenancy: Pick<TenancyRepos["tenancy"], "updateUserName" | "notifyInvitee">;
    audit: TenancyRepos["audit"];
  }>;
  clock: Clock;
  entitlements: EntitlementService;
  /** Best-effort email delivery (outbox); never throws. */
  sendEmail: (message: TenancyMail) => Promise<void>;
  /** Builds the invitation email for a URL. */
  invitationEmail: (
    workspaceName: string,
    inviterName: string,
    url: string,
  ) => Omit<TenancyMail, "to">;
  appUrl: string;
  logger: Logger;
}
