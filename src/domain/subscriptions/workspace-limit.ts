import { DomainError } from "../shared/errors";
import type { BillingCycle, SubscriptionPhase } from "./entitlements";

export interface WorkspaceLimitInput {
  phase: SubscriptionPhase;
  billingCycle: BillingCycle | null;
  /** null = unlimited by plan, bounded by fair use. */
  planMaxWorkspaces: number | null;
  /** Super Admin per-organization override; wins over everything when set. */
  overrideMaxWorkspaces: number | null;
  fairUseMaxWorkspaces: number;
}

export function effectiveMaxWorkspaces(i: WorkspaceLimitInput): number {
  if (i.overrideMaxWorkspaces !== null) return i.overrideMaxWorkspaces;
  if (i.phase === "TRIAL" || i.phase === "GRACE") return 1;
  // Multi-workspace plans are an annual-only benefit.
  if (i.billingCycle === "MONTHLY") return 1;
  return i.planMaxWorkspaces ?? i.fairUseMaxWorkspaces;
}

export function assertCanCreateWorkspace(
  i: WorkspaceLimitInput & {
    currentWorkspaces: number;
    createdLast24h: number;
    createsPerDay: number;
  },
): void {
  const limit = effectiveMaxWorkspaces(i);
  if (i.currentWorkspaces >= limit) {
    const fairUse =
      i.overrideMaxWorkspaces === null &&
      i.planMaxWorkspaces === null &&
      limit === i.fairUseMaxWorkspaces;
    const reason = fairUse ? "FAIR_USE" : "PLAN_LIMIT";
    throw new DomainError(
      "LIMIT_REACHED",
      fairUse
        ? `You have reached the fair-use limit of ${limit} workspaces. Contact support to raise it.`
        : `Your plan allows up to ${limit} ${limit === 1 ? "workspace" : "workspaces"}`,
      { details: { reason, limit, current: i.currentWorkspaces } },
    );
  }
  if (i.createdLast24h >= i.createsPerDay) {
    throw new DomainError(
      "LIMIT_REACHED",
      "You have created too many workspaces today. Try again tomorrow.",
      { details: { reason: "DAILY_LIMIT", limit: i.createsPerDay, current: i.createdLast24h } },
    );
  }
}
