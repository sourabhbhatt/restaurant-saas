import { mergePlatformSettings, type PlatformSettings } from "@/domain/platform/settings";
import { notFound } from "@/domain/shared/errors";
import {
  assertFeature,
  assertOperationAllowed,
  assertWithinLimit,
  resolveEntitlements,
  type Entitlements,
  type FeatureKey,
  type LimitKey,
  type OperationKind,
} from "@/domain/subscriptions/entitlements";

import type {
  EntitlementRepository,
  OrganizationSubscriptionContext,
  SubscriptionContext,
  WorkspaceUsage,
} from "../ports/core-repositories";
import type { Clock } from "../ports/observability";

const LIMIT_TO_USAGE: Record<LimitKey, keyof WorkspaceUsage> = {
  maxRestaurants: "restaurants",
  maxBranches: "branches",
  maxStaff: "staff",
  maxTables: "tables",
  maxMenuItems: "menuItems",
  storageMb: "storageBytes",
};

export interface EntitlementService {
  getPlatformSettings(): Promise<PlatformSettings>;
  /**
   * The single source of truth for what a workspace may do right now: its
   * organization's entitlements, narrowed by the workspace's own status and
   * Super Admin overrides.
   */
  getWorkspaceEntitlements(workspaceId: string): Promise<Entitlements>;
  /** The organization's subscription phase and plan, shared by all its workspaces. */
  getOrganizationEntitlements(organizationId: string): Promise<Entitlements>;
  getUsage(workspaceId: string): Promise<WorkspaceUsage>;
  assertOperation(workspaceId: string, kind: OperationKind): Promise<Entitlements>;
  assertFeature(workspaceId: string, feature: FeatureKey): Promise<void>;
  /** Throws LIMIT_REACHED if creating one more resource would exceed the plan. */
  assertCanAdd(workspaceId: string, limit: LimitKey, adding?: number): Promise<void>;
}

export function createEntitlementService(deps: {
  repo: EntitlementRepository;
  clock: Clock;
}): EntitlementService {
  const { repo, clock } = deps;
  const settings = async () => mergePlatformSettings(await repo.loadPlatformSettingRows());

  const resolve = (
    ctx: OrganizationSubscriptionContext | SubscriptionContext,
    s: PlatformSettings,
  ) => {
    const workspaceStatus = "workspaceStatus" in ctx ? ctx.workspaceStatus : "ACTIVE";
    return resolveEntitlements({
      // A suspended organization suspends every workspace in it.
      workspaceStatus:
        workspaceStatus === "ACTIVE" && ctx.organization?.status === "SUSPENDED"
          ? "SUSPENDED"
          : workspaceStatus,
      subscription: ctx.subscription,
      plan: ctx.plan,
      overrides: "overrides" in ctx ? ctx.overrides : [],
      policy: { graceDays: s.graceDays, restrictedMode: s.restrictedMode },
      now: clock.now(),
    });
  };

  const get = async (workspaceId: string) => {
    const [ctx, s] = await Promise.all([repo.loadSubscriptionContext(workspaceId), settings()]);
    if (!ctx) throw notFound("Workspace");
    return resolve(ctx, s);
  };

  return {
    getPlatformSettings: settings,
    getWorkspaceEntitlements: get,
    async getOrganizationEntitlements(organizationId) {
      const [ctx, s] = await Promise.all([
        repo.loadOrganizationSubscriptionContext(organizationId),
        settings(),
      ]);
      if (!ctx) throw notFound("Organization");
      return resolve(ctx, s);
    },
    getUsage: (workspaceId) => repo.countUsage(workspaceId),
    async assertOperation(workspaceId, kind) {
      const ent = await get(workspaceId);
      assertOperationAllowed(ent, kind);
      return ent;
    },
    async assertFeature(workspaceId, feature) {
      assertFeature(await get(workspaceId), feature);
    },
    async assertCanAdd(workspaceId, limit, adding = 1) {
      const [ent, usage] = await Promise.all([get(workspaceId), repo.countUsage(workspaceId)]);
      assertOperationAllowed(ent, "grow");
      let current = usage[LIMIT_TO_USAGE[limit]];
      if (limit === "storageMb") current = Math.ceil(current / (1024 * 1024));
      assertWithinLimit(ent, limit, current + adding - 1);
    },
  };
}
