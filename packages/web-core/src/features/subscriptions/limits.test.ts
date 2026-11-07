import { describe, expect, it } from "vitest";

import { ApiError } from "@ros/api-client";

import {
  accessBlockReason,
  canAdd,
  canAddBranch,
  isPlanError,
  limitReachedMessage,
  planLimitsSentence,
  usageSummary,
  usedFor,
} from "./limits";
import { makeEntitlements, makeUsage } from "./limits.fixtures";

describe("canAdd", () => {
  it("allows below the limit and reports what is left", () => {
    const check = canAdd(makeEntitlements(), makeUsage({ restaurants: 2 }), "maxRestaurants");
    expect(check).toMatchObject({ allowed: true, reason: null, used: 2, limit: 3, remaining: 1 });
  });

  it("blocks at the limit with the plan's number in the reason", () => {
    const check = canAdd(makeEntitlements(), makeUsage({ restaurants: 3 }), "maxRestaurants");
    expect(check.allowed).toBe(false);
    expect(check.blockedBy).toBe("limit");
    expect(check.remaining).toBe(0);
    expect(check.reason).toBe(
      "You've reached the 3-restaurant limit of your plan. Upgrade to add more.",
    );
  });

  it("treats null as unlimited", () => {
    const ent = makeEntitlements({
      limits: { ...makeEntitlements().limits, maxRestaurants: null },
    });
    const check = canAdd(ent, makeUsage({ restaurants: 500 }), "maxRestaurants");
    expect(check).toMatchObject({ allowed: true, limit: null, remaining: null });
  });

  it("checks a batch against the remaining room", () => {
    const usage = makeUsage({ tables: 195 });
    expect(canAdd(makeEntitlements(), usage, "maxTables", 5).allowed).toBe(true);
    const over = canAdd(makeEntitlements(), usage, "maxTables", 10);
    expect(over.allowed).toBe(false);
    expect(over.reason).toBe("Your plan allows 5 more tables. Upgrade to add more.");
  });

  it("blocks growth in the grace period (LIMITED) even below the limit", () => {
    const ent = makeEntitlements({ phase: "GRACE", accessLevel: "LIMITED" });
    const check = canAdd(ent, makeUsage({ restaurants: 0 }), "maxRestaurants");
    expect(check.allowed).toBe(false);
    expect(check.blockedBy).toBe("access");
    expect(check.reason).toBe(
      "Your subscription is in its grace period. Renew your plan to add new restaurants.",
    );
  });

  it("blocks growth when read-only, even on unlimited plans", () => {
    const ent = makeEntitlements({
      phase: "RESTRICTED",
      accessLevel: "READ_ONLY",
      limits: { ...makeEntitlements().limits, maxStaff: null },
    });
    const check = canAdd(ent, makeUsage(), "maxStaff");
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/read-only/);
    expect(check.reason).toMatch(/staff members/);
  });

  it("explains suspension (NONE)", () => {
    const ent = makeEntitlements({ phase: "SUSPENDED", accessLevel: "NONE" });
    expect(canAdd(ent, makeUsage(), "maxTables").reason).toBe(
      "This workspace is suspended. Contact support to restore access.",
    );
  });

  it("counts storage in whole MB, rounded up like the server", () => {
    const usage = makeUsage({ storageBytes: 1999 * 1024 * 1024 + 1 });
    expect(usedFor(usage, "storageMb")).toBe(2000);
    expect(canAdd(makeEntitlements(), usage, "storageMb").allowed).toBe(false);
  });
});

describe("canAddBranch", () => {
  it("needs multi_branch for a restaurant's second branch", () => {
    const ent = makeEntitlements({ features: ["qr_ordering"] });
    expect(canAddBranch(ent, makeUsage(), 0).allowed).toBe(true);
    const second = canAddBranch(ent, makeUsage(), 1);
    expect(second.allowed).toBe(false);
    expect(second.blockedBy).toBe("feature");
    expect(second.reason).toMatch(/Multiple branches per restaurant/);
  });

  it("applies the workspace-wide branch limit first", () => {
    const check = canAddBranch(makeEntitlements(), makeUsage({ branches: 10 }), 0);
    expect(check.blockedBy).toBe("limit");
    expect(check.reason).toBe(
      "You've reached the 10-branch limit of your plan. Upgrade to add more.",
    );
  });
});

describe("copy helpers", () => {
  it("summarises usage on the plan", () => {
    expect(usageSummary(makeEntitlements(), makeUsage(), "maxRestaurants")).toBe(
      "2 of 3 restaurants used on Pro",
    );
    expect(usageSummary(makeEntitlements({ phase: "TRIAL" }), makeUsage(), "maxRestaurants")).toBe(
      "2 of 3 restaurants used on Pro (free trial)",
    );
    const unlimited = makeEntitlements({
      planName: "Enterprise",
      limits: { ...makeEntitlements().limits, maxTables: null },
    });
    expect(usageSummary(unlimited, makeUsage(), "maxTables")).toBe(
      "30 tables in use · unlimited on Enterprise",
    );
  });

  it("lists the plan's numbers, unlimited when null", () => {
    const ent = makeEntitlements({
      limits: { ...makeEntitlements().limits, maxTables: null },
    });
    expect(planLimitsSentence(ent)).toBe(
      "up to 3 restaurants, 10 branches, unlimited tables, 75 staff members and 1,000 menu items",
    );
  });

  it("phrases multi-word limits", () => {
    expect(limitReachedMessage("maxStaff", 10)).toBe(
      "You've reached the 10-staff-member limit of your plan. Upgrade to add more.",
    );
  });

  it("has no access reason on FULL", () => {
    expect(accessBlockReason(makeEntitlements())).toBeNull();
  });
});

describe("isPlanError", () => {
  it("recognises the plan error codes only", () => {
    const err = (code: string) => new ApiError({ status: 402, code, message: "x" });
    expect(isPlanError(err("LIMIT_REACHED"))).toBe(true);
    expect(isPlanError(err("ENTITLEMENT_REQUIRED"))).toBe(true);
    expect(isPlanError(err("WORKSPACE_RESTRICTED"))).toBe(true);
    expect(isPlanError(err("VALIDATION_FAILED"))).toBe(false);
    expect(isPlanError(new Error("x"))).toBe(false);
  });
});
