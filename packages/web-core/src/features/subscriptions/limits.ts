import type { WorkspaceUsageDto } from "@ros/contracts/platform";
import { ApiError } from "@ros/api-client";
import {
  FEATURES,
  limitLabel,
  type Entitlements,
  type LimitKey,
} from "@ros/domain/subscriptions/entitlements";

import { formatLimit } from "./subscription-ui";

/**
 * Client-side view of plan limits. The server is always the source of truth
 * (it re-checks every create); these helpers only decide which buttons to
 * disable and what to say about it, using the same counts the server uses.
 * Every limit is a workspace-wide total (e.g. branches across all restaurants).
 */

export const USAGE_FIELD: Record<LimitKey, keyof WorkspaceUsageDto> = {
  maxRestaurants: "restaurants",
  maxBranches: "branches",
  maxStaff: "staff",
  maxTables: "tables",
  maxMenuItems: "menuItems",
  storageMb: "storageBytes",
};

const SINGULAR: Record<LimitKey, string> = {
  maxRestaurants: "restaurant",
  maxBranches: "branch",
  maxStaff: "staff member",
  maxTables: "table",
  maxMenuItems: "menu item",
  storageMb: "MB storage",
};

/** Usage in the unit of the limit (storage in whole MB, rounded up like the server). */
export function usedFor(usage: WorkspaceUsageDto, key: LimitKey): number {
  const v = usage[USAGE_FIELD[key]];
  return key === "storageMb" ? Math.ceil(v / (1024 * 1024)) : v;
}

/** "3 restaurants", "unlimited restaurants", "2.0 GB" */
export function limitPhrase(key: LimitKey, value: number | null): string {
  if (value === null)
    return key === "storageMb" ? "unlimited storage" : `unlimited ${limitLabel(key)}`;
  return formatLimit(key, value);
}

/** "Pro", "Pro (free trial)" or "your plan". */
export function planLabel(ent: Entitlements): string {
  if (!ent.planName) return "your plan";
  return ent.phase === "TRIAL" ? `${ent.planName} (free trial)` : ent.planName;
}

/**
 * Why growth actions are blocked by the subscription state, or null when they
 * are allowed. Mirrors `isOperationAllowed(level, "grow")` on the server.
 */
export function accessBlockReason(ent: Entitlements, key?: LimitKey): string | null {
  const what = key ? `new ${limitLabel(key)}` : "anything new";
  switch (ent.accessLevel) {
    case "FULL":
      return null;
    case "LIMITED":
      return `Your subscription is in its grace period. Renew your plan to add ${what}.`;
    case "READ_ONLY":
      return `Your subscription has ended and the workspace is read-only. Renew your plan to add ${what}.`;
    case "NONE":
      return "This workspace is suspended. Contact support to restore access.";
  }
}

/** "You've reached the 3-restaurant limit of your plan. Upgrade to add more." */
export function limitReachedMessage(key: LimitKey, limit: number): string {
  if (key === "storageMb") {
    return `You've used all ${formatLimit(key, limit)} of storage on your plan. Upgrade or delete unused images to add more.`;
  }
  const n = limit.toLocaleString("en-IN");
  return `You've reached the ${n}-${SINGULAR[key].replace(/ /g, "-")} limit of your plan. Upgrade to add more.`;
}

/** "2 of 3 restaurants used on Pro" / "5 tables in use · unlimited on Enterprise" */
export function usageSummary(ent: Entitlements, usage: WorkspaceUsageDto, key: LimitKey): string {
  const used = usedFor(usage, key);
  const limit = ent.limits[key];
  const plan = planLabel(ent);
  const noun = key === "storageMb" ? "MB of storage" : limitLabel(key);
  if (limit === null)
    return `${used.toLocaleString("en-IN")} ${noun} in use · unlimited on ${plan}`;
  return `${used.toLocaleString("en-IN")} of ${limit.toLocaleString("en-IN")} ${noun} used on ${plan}`;
}

export type AddBlock = "access" | "limit" | "feature";

export interface AddCheck {
  allowed: boolean;
  /** Why not; shown next to the disabled control. */
  reason: string | null;
  blockedBy: AddBlock | null;
  used: number;
  /** null = unlimited */
  limit: number | null;
  /** How many more can be added; null = unlimited. */
  remaining: number | null;
}

/**
 * Can `adding` more of `key` be created right now? Accounts for unlimited
 * (null) limits and for the access level: grace (LIMITED), READ_ONLY and NONE
 * all block growth whatever the count.
 */
export function canAdd(
  ent: Entitlements,
  usage: WorkspaceUsageDto,
  key: LimitKey,
  adding = 1,
): AddCheck {
  const used = usedFor(usage, key);
  const limit = ent.limits[key];
  const remaining = limit === null ? null : Math.max(0, limit - used);
  const base = { used, limit, remaining };
  const access = accessBlockReason(ent, key);
  if (access) return { ...base, allowed: false, reason: access, blockedBy: "access" };
  if (limit !== null && used + adding > limit) {
    const reason =
      remaining !== null && remaining > 0 && adding > 1
        ? `Your plan allows ${remaining.toLocaleString("en-IN")} more ${remaining === 1 ? SINGULAR[key] : limitLabel(key)}. Upgrade to add more.`
        : limitReachedMessage(key, limit);
    return { ...base, allowed: false, reason, blockedBy: "limit" };
  }
  return { ...base, allowed: true, reason: null, blockedBy: null };
}

/**
 * Branches also need the multi-branch feature once a restaurant has one branch
 * (the server checks this after the workspace-wide branch limit).
 */
export function canAddBranch(
  ent: Entitlements,
  usage: WorkspaceUsageDto,
  branchesInRestaurant: number,
): AddCheck {
  const check = canAdd(ent, usage, "maxBranches");
  if (!check.allowed) return check;
  if (branchesInRestaurant >= 1 && !ent.features.includes("multi_branch")) {
    return {
      ...check,
      allowed: false,
      blockedBy: "feature",
      reason: `${FEATURES.multi_branch} isn't included in ${planLabel(ent)}. Upgrade to add another branch.`,
    };
  }
  return check;
}

/** Plan limit, missing feature or restricted subscription errors from the API. */
export function isPlanError(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    (error.code === "LIMIT_REACHED" ||
      error.code === "ENTITLEMENT_REQUIRED" ||
      error.code === "WORKSPACE_RESTRICTED")
  );
}

/** The limit keys a plan summary lists, in reading order. */
export const SUMMARY_KEYS: LimitKey[] = [
  "maxRestaurants",
  "maxBranches",
  "maxTables",
  "maxStaff",
  "maxMenuItems",
];

/**
 * "up to 3 restaurants, 10 branches, 200 tables, 75 staff members and 1,000 menu items"
 * (all workspace-wide totals).
 */
export function planLimitsSentence(ent: Entitlements, keys: LimitKey[] = SUMMARY_KEYS): string {
  const parts = keys.map((k) => limitPhrase(k, ent.limits[k]));
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return ent.limits[keys[0]!] === null ? list! : `up to ${list}`;
}
