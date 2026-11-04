import {
  resolveEntitlements,
  type PlanRecord,
  type SubscriptionPhase,
  type SubscriptionPolicy,
  type SubscriptionRecord,
  type WorkspaceStatus,
} from "../subscriptions/entitlements";

/**
 * Platform-level classification of workspaces for the Super Admin overview.
 * Phases come from `resolveEntitlements` (dates, not stored status), so the
 * dashboard agrees with what each workspace can actually do right now.
 */

export interface WorkspaceSubscriptionRow {
  workspaceStatus: WorkspaceStatus;
  subscription: (SubscriptionRecord & { trialStartsAt: Date | null }) | null;
  plan: PlanRecord | null;
}

export interface WorkspaceClassification {
  phase: SubscriptionPhase;
  /** In an unexpired trial. */
  trial: boolean;
  /** Was on a trial that has run out without converting (grace or restricted). */
  expiredTrial: boolean;
  /** On a paid subscription that still grants access (active or in grace). */
  paid: boolean;
}

export function classifyWorkspace(
  row: WorkspaceSubscriptionRow,
  policy: SubscriptionPolicy,
  now: Date,
): WorkspaceClassification {
  const { phase } = resolveEntitlements({
    workspaceStatus: row.workspaceStatus,
    subscription: row.subscription,
    plan: row.plan,
    overrides: [],
    policy,
    now,
  });
  const sub = row.subscription;
  const wasTrial =
    sub !== null &&
    (sub.status === "TRIALING" || (sub.status === "EXPIRED" && sub.trialEndsAt !== null));
  const live = row.workspaceStatus === "ACTIVE";
  return {
    phase,
    trial: phase === "TRIAL",
    expiredTrial: live && wasTrial && (phase === "GRACE" || phase === "RESTRICTED"),
    paid: live && sub?.status === "ACTIVE" && (phase === "ACTIVE" || phase === "GRACE"),
  };
}

/** Converted trials / trials started, as a percentage with one decimal (null with no trials). */
export function conversionRate(converted: number, started: number): number | null {
  if (started <= 0) return null;
  return Math.round((Math.min(converted, started) / started) * 1000) / 10;
}
