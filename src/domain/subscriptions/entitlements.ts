import { DomainError } from "../shared/errors";

/**
 * Subscription lifecycle and entitlement resolution. Pure: given stored
 * records and "now", returns what a workspace may do. Status is always
 * computed from dates at read time, so a late background job can never wrongly
 * grant or remove access. Plans, limits, trial and grace lengths are data
 * (edited by Super Admin), never constants in UI code.
 */

/**
 * `advertised` is true only for features the server enforces. The pricing page
 * and plan editor list advertised features only; a test pins each one to an
 * enforcement call site.
 */
export const FEATURE_META = {
  qr_ordering: { label: "QR table ordering", advertised: true },
  kitchen_display: { label: "Kitchen display system", advertised: true },
  multi_branch: { label: "Multiple branches per restaurant", advertised: true },
  analytics: { label: "Analytics dashboards", advertised: true },
  advanced_analytics: { label: "Branch comparison and advanced reports", advertised: true },
  custom_roles: { label: "Custom staff roles", advertised: true },
  offline_mode: { label: "Offline-first staff devices", advertised: false },
  push_notifications: { label: "Browser push notifications", advertised: false },
  email_notifications: { label: "Email notifications", advertised: false },
  data_export: { label: "Data export", advertised: false },
} as const satisfies Record<string, { label: string; advertised: boolean }>;
export type FeatureKey = keyof typeof FEATURE_META;
export const FEATURE_KEYS = Object.keys(FEATURE_META) as FeatureKey[];
export const ADVERTISED_FEATURES: FeatureKey[] = FEATURE_KEYS.filter(
  (k) => FEATURE_META[k].advertised,
);
/** Label map, derived from FEATURE_META. */
export const FEATURES = Object.fromEntries(
  FEATURE_KEYS.map((k) => [k, FEATURE_META[k].label]),
) as Record<FeatureKey, string>;

export const LIMIT_KEYS = [
  "maxRestaurants",
  "maxBranches",
  "maxStaff",
  "maxTables",
  "maxMenuItems",
  "storageMb",
] as const;
export type LimitKey = (typeof LIMIT_KEYS)[number];
/** null = unlimited */
export type PlanLimits = Record<LimitKey, number | null>;

export const SUBSCRIPTION_STATUSES = ["TRIALING", "ACTIVE", "CANCELLED", "EXPIRED"] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const WORKSPACE_STATUSES = ["ACTIVE", "SUSPENDED", "DEACTIVATED"] as const;
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number];

export const BILLING_CYCLES = ["MONTHLY", "ANNUAL"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** Effective phase computed from dates. */
export type SubscriptionPhase =
  "TRIAL" | "ACTIVE" | "GRACE" | "RESTRICTED" | "SUSPENDED" | "DEACTIVATED" | "NONE";

/**
 * FULL: everything the plan allows.
 * LIMITED: grace period — day-to-day operations continue, growth actions
 *          (new restaurants, branches, staff invites) are blocked.
 * READ_ONLY: after grace — data visible, writes blocked except winding down
 *            open bills (recording payments, closing sessions).
 * NONE: suspended/deactivated by the platform.
 */
export type AccessLevel = "FULL" | "LIMITED" | "READ_ONLY" | "NONE";

export interface PlanRecord {
  id: string;
  key: string;
  name: string;
  limits: PlanLimits;
  features: readonly FeatureKey[];
}

export interface SubscriptionRecord {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  cancelledAt: Date | null;
}

export interface EntitlementOverride {
  key: string;
  value: unknown;
}

export interface SubscriptionPolicy {
  graceDays: number;
  /** Behaviour after the grace period. */
  restrictedMode: "READ_ONLY" | "NONE";
}

export interface Entitlements {
  phase: SubscriptionPhase;
  accessLevel: AccessLevel;
  planKey: string | null;
  planName: string | null;
  limits: PlanLimits;
  features: FeatureKey[];
  trialEndsAt: Date | null;
  trialDaysRemaining: number | null;
  periodEndsAt: Date | null;
  graceEndsAt: Date | null;
}

const DAY_MS = 86_400_000;

export const UNLIMITED: PlanLimits = {
  maxRestaurants: null,
  maxBranches: null,
  maxStaff: null,
  maxTables: null,
  maxMenuItems: null,
  storageMb: null,
};

export const NO_ACCESS_LIMITS: PlanLimits = {
  maxRestaurants: 0,
  maxBranches: 0,
  maxStaff: 0,
  maxTables: 0,
  maxMenuItems: 0,
  storageMb: 0,
};

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Whole days remaining, rounded up; 0 once the moment has passed. */
export function daysRemaining(until: Date, now: Date): number {
  return Math.max(0, Math.ceil((until.getTime() - now.getTime()) / DAY_MS));
}

function applyOverrides(
  limits: PlanLimits,
  features: FeatureKey[],
  overrides: readonly EntitlementOverride[],
): { limits: PlanLimits; features: FeatureKey[] } {
  const nextLimits = { ...limits };
  const nextFeatures = new Set(features);
  for (const o of overrides) {
    if ((LIMIT_KEYS as readonly string[]).includes(o.key)) {
      if (o.value === null || (typeof o.value === "number" && o.value >= 0)) {
        nextLimits[o.key as LimitKey] = o.value as number | null;
      }
    } else if (o.key.startsWith("feature:")) {
      const feature = o.key.slice("feature:".length);
      if ((FEATURE_KEYS as string[]).includes(feature)) {
        if (o.value === true) nextFeatures.add(feature as FeatureKey);
        if (o.value === false) nextFeatures.delete(feature as FeatureKey);
      }
    }
  }
  return { limits: nextLimits, features: [...nextFeatures] };
}

export interface ResolveInput {
  workspaceStatus: WorkspaceStatus;
  subscription: SubscriptionRecord | null;
  plan: PlanRecord | null;
  overrides: readonly EntitlementOverride[];
  policy: SubscriptionPolicy;
  now: Date;
}

export function resolveEntitlements(input: ResolveInput): Entitlements {
  const { subscription: sub, plan, policy, now } = input;
  const base = applyOverrides(
    plan?.limits ?? NO_ACCESS_LIMITS,
    [...(plan?.features ?? [])],
    input.overrides,
  );
  const result = (
    phase: SubscriptionPhase,
    accessLevel: AccessLevel,
    extra: Partial<Entitlements> = {},
  ): Entitlements => ({
    phase,
    accessLevel,
    planKey: plan?.key ?? null,
    planName: plan?.name ?? null,
    limits: base.limits,
    features: base.features,
    trialEndsAt: sub?.trialEndsAt ?? null,
    trialDaysRemaining: null,
    periodEndsAt: sub?.currentPeriodEnd ?? null,
    graceEndsAt: null,
    ...extra,
  });

  if (input.workspaceStatus === "SUSPENDED") return result("SUSPENDED", "NONE");
  if (input.workspaceStatus === "DEACTIVATED") return result("DEACTIVATED", "NONE");
  if (!sub || !plan) return result("NONE", policy.restrictedMode);

  const endOfAccess =
    sub.status === "TRIALING"
      ? sub.trialEndsAt
      : sub.status === "EXPIRED"
        ? null
        : sub.currentPeriodEnd;

  if (sub.status === "EXPIRED" || !endOfAccess) {
    return result("RESTRICTED", policy.restrictedMode);
  }

  const graceEndsAt = addDays(endOfAccess, policy.graceDays);
  if (now < endOfAccess) {
    if (sub.status === "TRIALING") {
      return result("TRIAL", "FULL", {
        trialDaysRemaining: daysRemaining(endOfAccess, now),
        graceEndsAt,
      });
    }
    return result("ACTIVE", "FULL", { graceEndsAt });
  }
  if (now < graceEndsAt) {
    return result("GRACE", "LIMITED", {
      graceEndsAt,
      trialDaysRemaining: sub.status === "TRIALING" ? 0 : null,
    });
  }
  return result("RESTRICTED", policy.restrictedMode, {
    graceEndsAt,
    trialDaysRemaining: sub.status === "TRIALING" ? 0 : null,
  });
}

/** Kinds of operation an entitlement check guards. */
export type OperationKind =
  /** Normal daily operations: orders, menu edits, tables. */
  | "operate"
  /** Growth: new restaurants/branches/staff, plan-limited resources. */
  | "grow"
  /** Winding down open bills: recording payments, closing sessions. */
  | "settle"
  /** Reading data. */
  | "read";

export function isOperationAllowed(level: AccessLevel, kind: OperationKind): boolean {
  switch (level) {
    case "FULL":
      return true;
    case "LIMITED":
      return kind !== "grow";
    case "READ_ONLY":
      return kind === "read" || kind === "settle";
    case "NONE":
      return false;
  }
}

export function assertOperationAllowed(ent: Entitlements, kind: OperationKind): void {
  if (isOperationAllowed(ent.accessLevel, kind)) return;
  const message =
    ent.accessLevel === "NONE"
      ? "This workspace is suspended. Contact support to restore access."
      : ent.accessLevel === "READ_ONLY"
        ? "Your subscription has expired. The workspace is read-only until it is reactivated."
        : "Your trial or subscription has ended. Upgrade to add new restaurants, branches or staff.";
  throw new DomainError("WORKSPACE_RESTRICTED", message, {
    details: { phase: ent.phase, accessLevel: ent.accessLevel },
  });
}

export function assertFeature(ent: Entitlements, feature: FeatureKey): void {
  if (!ent.features.includes(feature)) {
    throw new DomainError(
      "ENTITLEMENT_REQUIRED",
      `${FEATURES[feature]} is not included in your plan`,
      {
        details: { feature },
      },
    );
  }
}

export function assertWithinLimit(ent: Entitlements, key: LimitKey, currentCount: number): void {
  const limit = ent.limits[key];
  if (limit !== null && currentCount >= limit) {
    throw new DomainError("LIMIT_REACHED", `Your plan allows up to ${limit} ${limitLabel(key)}`, {
      details: { key, limit, current: currentCount },
    });
  }
}

export function limitLabel(key: LimitKey): string {
  const labels: Record<LimitKey, string> = {
    maxRestaurants: "restaurants",
    maxBranches: "branches",
    maxStaff: "staff members",
    maxTables: "tables",
    maxMenuItems: "menu items",
    storageMb: "MB of storage",
  };
  return labels[key];
}

/** Reminder days relative to trial start (configurable; defaults 7, 12, 14). */
export function dueTrialReminders(
  trialStartsAt: Date,
  reminderDays: readonly number[],
  alreadySent: readonly number[],
  now: Date,
): number[] {
  return reminderDays.filter(
    (day) => !alreadySent.includes(day) && now.getTime() >= addDays(trialStartsAt, day).getTime(),
  );
}
