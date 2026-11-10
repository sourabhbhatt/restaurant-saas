import {
  assertWithinLimit,
  type Entitlements,
  type LimitKey,
} from "@ros/domain/subscriptions/entitlements";

import type { LimitRepository, WorkspaceUsage } from "../ports/core-repositories";

const USAGE_OF: Record<LimitKey, keyof WorkspaceUsage> = {
  maxRestaurants: "restaurants",
  maxBranches: "branches",
  maxStaff: "staff",
  maxTables: "tables",
  maxMenuItems: "menuItems",
  storageMb: "storageBytes",
};

/**
 * Reserve `adding` units of a plan limit inside the transaction that inserts
 * them. `EntitlementService.assertCanAdd` runs before the transaction and
 * gives the early, friendly refusal; it cannot stop two concurrent requests
 * that both read "one slot left". This takes a workspace lock first, so the
 * second request counts the first one's committed row and is refused.
 */
export async function reserveLimit(
  r: { limits: LimitRepository },
  input: { entitlements: Entitlements; workspaceId: string; key: LimitKey; adding?: number },
): Promise<void> {
  const limit = input.entitlements.limits[input.key];
  if (limit === null) return;
  await r.limits.lockWorkspace(input.workspaceId);
  const usage = await r.limits.countUsage(input.workspaceId);
  let current = usage[USAGE_OF[input.key]];
  if (input.key === "storageMb") current = Math.ceil(current / (1024 * 1024));
  assertWithinLimit(input.entitlements, input.key, current + (input.adding ?? 1) - 1);
}
