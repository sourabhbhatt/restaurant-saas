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

import type { EntitlementRepository, WorkspaceUsage } from "../ports/core-repositories";
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
  /** The single source of truth for what a workspace may do right now. */
  getWorkspaceEntitlements(workspaceId: string): Promise<Entitlements>;
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

  const get = async (workspaceId: string) => {
    const [ctx, s] = await Promise.all([repo.loadSubscriptionContext(workspaceId), settings()]);
    if (!ctx) throw notFound("Workspace");
    return resolveEntitlements({
      workspaceStatus: ctx.workspaceStatus,
      subscription: ctx.subscription,
      plan: ctx.plan,
      overrides: ctx.overrides,
      policy: { graceDays: s.graceDays, restrictedMode: s.restrictedMode },
      now: clock.now(),
    });
  };

  return {
    getPlatformSettings: settings,
    getWorkspaceEntitlements: get,
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
