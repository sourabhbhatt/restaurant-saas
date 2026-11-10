import {
  assertWithinLimit,
  type Entitlements,
  type LimitKey,
} from "@ros/domain/subscriptions/entitlements";

import type { LimitRepository, WorkspaceUsage } from "../ports/core-repositories";

const MIB = 1024 * 1024;

const USAGE_OF: Record<Exclude<LimitKey, "storageMb">, keyof WorkspaceUsage> = {
  maxRestaurants: "restaurants",
  maxBranches: "branches",
  maxStaff: "staff",
  maxTables: "tables",
  maxMenuItems: "menuItems",
};

export type LimitReservation =
  | { key: Exclude<LimitKey, "storageMb">; adding?: number }
  /** Storage is reserved in bytes against the fresh byte count, never in pre-rounded MB. */
  | { key: "storageMb"; addingBytes: number };

/**
 * Reserve a plan limit inside the transaction that inserts the resource.
 * `EntitlementService.assertCanAdd` runs before the transaction and gives the
 * early, friendly refusal; it cannot stop two concurrent requests that both
 * read "one slot left". This takes a workspace lock first, so the second
 * request counts the first one's committed row and is refused.
 */
export async function reserveLimit(
  r: { limits: LimitRepository },
  input: { entitlements: Entitlements; workspaceId: string } & LimitReservation,
): Promise<void> {
  const limit = input.entitlements.limits[input.key];
  if (limit === null) return;
  await r.limits.lockWorkspace(input.workspaceId);
  const usage = await r.limits.countUsage(input.workspaceId);
  if (input.key === "storageMb") {
    // Refuse when the total after this file, rounded up to whole MB, exceeds the plan.
    const totalMb = Math.ceil((usage.storageBytes + input.addingBytes) / MIB);
    assertWithinLimit(input.entitlements, "storageMb", totalMb - 1);
    return;
  }
  const current = usage[USAGE_OF[input.key]];
  assertWithinLimit(input.entitlements, input.key, current + (input.adding ?? 1) - 1);
}
