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
