import type { WorkspaceUsageDto } from "@ros/contracts/platform";
import type { Entitlements } from "@ros/domain/subscriptions/entitlements";

/** Test fixtures: a Pro plan with some usage. Not used by app code. */
export function makeEntitlements(over: Partial<Entitlements> = {}): Entitlements {
  return {
    phase: "ACTIVE",
    accessLevel: "FULL",
    planKey: "pro",
    planName: "Pro",
    limits: {
      maxRestaurants: 3,
      maxBranches: 10,
      maxStaff: 75,
      maxTables: 200,
      maxMenuItems: 1000,
      storageMb: 2000,
    },
    features: ["multi_branch", "qr_ordering"],
    trialEndsAt: null,
    trialDaysRemaining: null,
    periodEndsAt: null,
    graceEndsAt: null,
    ...over,
  };
}

export function makeUsage(over: Partial<WorkspaceUsageDto> = {}): WorkspaceUsageDto {
  return {
    restaurants: 2,
    branches: 4,
    staff: 6,
    tables: 30,
    menuItems: 120,
    storageBytes: 5 * 1024 * 1024,
    ...over,
  };
}
