import type { TransactionRunner } from "@/infrastructure/database/interfaces/transaction";

import type { Clock } from "../../ports/observability";
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
  /** Owner-level runner, used only to resolve an invitation token to its workspace. */
  lookup: TransactionRunner<TenancyRepos>;
  /**
   * Owner-level runner for writes outside the bound workspace: the actor's own
   * profile, and the workspace-less notification to an invited existing user.
   */
  account: TransactionRunner<TenancyRepos>;
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
}
