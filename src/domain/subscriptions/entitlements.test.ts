import { describe, expect, it } from "vitest";

import {
  addDays,
  assertWithinLimit,
  isOperationAllowed,
  resolveEntitlements,
  type PlanRecord,
} from "./entitlements";

const plan: PlanRecord = {
  id: "p",
  key: "starter",
  name: "Starter",
  limits: {
    maxRestaurants: 1,
    maxBranches: 1,
    maxStaff: 5,
    maxTables: 10,
    maxMenuItems: 50,
    storageMb: 100,
  },
  features: ["qr_ordering"],
};
const start = new Date("2026-01-01T00:00:00Z");
const trial = {
  status: "TRIALING" as const,
  trialEndsAt: addDays(start, 30),
  currentPeriodEnd: null,
  cancelledAt: null,
};
const policy = { graceDays: 7, restrictedMode: "READ_ONLY" as const };
const resolve = (now: Date, extra: Partial<Parameters<typeof resolveEntitlements>[0]> = {}) =>
  resolveEntitlements({
    workspaceStatus: "ACTIVE",
    subscription: trial,
    plan,
    overrides: [],
    policy,
    now,
    ...extra,
  });

describe("resolveEntitlements", () => {
  it("moves TRIAL → GRACE → RESTRICTED with the clock", () => {
    const day1 = resolve(addDays(start, 1));
    expect(day1).toMatchObject({ phase: "TRIAL", accessLevel: "FULL", trialDaysRemaining: 29 });
    expect(resolve(addDays(start, 31))).toMatchObject({ phase: "GRACE", accessLevel: "LIMITED" });
    expect(resolve(addDays(start, 38))).toMatchObject({
      phase: "RESTRICTED",
      accessLevel: "READ_ONLY",
    });
  });

  it("keeps paid subscriptions active until period end", () => {
    const sub = {
      status: "ACTIVE" as const,
      trialEndsAt: null,
      currentPeriodEnd: addDays(start, 30),
      cancelledAt: null,
    };
    expect(resolve(addDays(start, 10), { subscription: sub }).phase).toBe("ACTIVE");
    expect(resolve(addDays(start, 40), { subscription: sub }).phase).toBe("RESTRICTED");
  });

  it("suspended workspaces have no access regardless of plan", () => {
    expect(resolve(addDays(start, 1), { workspaceStatus: "SUSPENDED" }).accessLevel).toBe("NONE");
  });

  it("applies Super Admin overrides to limits and features", () => {
    const e = resolve(addDays(start, 1), {
      overrides: [
        { key: "maxBranches", value: 3 },
        { key: "feature:analytics", value: true },
        { key: "feature:qr_ordering", value: false },
      ],
    });
    expect(e.limits.maxBranches).toBe(3);
    expect(e.features).toEqual(["analytics"]);
  });

  it("maps access levels to allowed operations", () => {
    expect(isOperationAllowed("LIMITED", "operate")).toBe(true);
    expect(isOperationAllowed("LIMITED", "grow")).toBe(false);
    expect(isOperationAllowed("READ_ONLY", "settle")).toBe(true);
    expect(isOperationAllowed("READ_ONLY", "operate")).toBe(false);
    expect(isOperationAllowed("NONE", "read")).toBe(false);
  });

  it("enforces limits", () => {
    const e = resolve(addDays(start, 1));
    expect(() => assertWithinLimit(e, "maxRestaurants", 0)).not.toThrow();
    expect(() => assertWithinLimit(e, "maxRestaurants", 1)).toThrow(/up to 1 restaurants/);
  });
});
