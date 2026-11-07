import { describe, expect, it } from "vitest";

import type { AccessGrants, Permission } from "../access/permissions";
import { canViewBranchReports } from "./access";
import {
  DEFAULT_OPEN_MINUTES_PER_DAY,
  occupancyPercent,
  openMinutesForWeekday,
  openMinutesInRange,
} from "./business-hours";
import {
  addDaysIso,
  daysInclusive,
  enumerateDates,
  isIsoDate,
  localDate,
  percentChange,
  resolveRange,
  weekdayOf,
} from "./date-range";
import { classifyWorkspace, conversionRate } from "./subscription-summary";

describe("date ranges", () => {
  it("does calendar arithmetic on ISO dates", () => {
    expect(addDaysIso("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysInclusive("2026-03-01", "2026-03-07")).toBe(7);
    expect(enumerateDates("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    expect(weekdayOf("2026-03-07")).toBe(6);
    expect(isIsoDate("2026-02-29")).toBe(false);
    expect(isIsoDate("2028-02-29")).toBe(true);
  });

  it("resolves the local date in a time zone", () => {
    const at = new Date("2026-03-07T18:00:00Z"); // 23:30 in India
    expect(localDate(at, "Asia/Kolkata")).toBe("2026-03-07");
    expect(localDate(new Date("2026-03-07T19:00:00Z"), "Asia/Kolkata")).toBe("2026-03-08");
    expect(localDate(at, "America/New_York")).toBe("2026-03-07");
    expect(localDate(at, "Not/AZone")).toBe("2026-03-07");
  });

  it("defaults to the last 7 days and computes the previous period", () => {
    expect(resolveRange({}, "2026-03-07")).toEqual({
      from: "2026-03-01",
      to: "2026-03-07",
      days: 7,
      previousFrom: "2026-02-22",
      previousTo: "2026-02-28",
    });
    expect(resolveRange({ from: "2026-03-07", to: "2026-03-07" }, "2026-03-10")).toMatchObject({
      days: 1,
      previousFrom: "2026-03-06",
      previousTo: "2026-03-06",
    });
    expect(resolveRange({ from: "2026-03-01" }, "2026-03-04").to).toBe("2026-03-04");
    expect(resolveRange({ to: "2026-03-10" }, "2026-03-04").from).toBe("2026-03-04");
  });

  it("rejects reversed and too-long ranges", () => {
    expect(() => resolveRange({ from: "2026-03-07", to: "2026-03-01" }, "2026-03-07")).toThrow(
      /on or before/,
    );
    expect(() => resolveRange({ from: "2025-01-01", to: "2026-03-01" }, "2026-03-07")).toThrow(
      /366/,
    );
    expect(resolveRange({ from: "2025-03-01", to: "2026-03-01" }, "2026-03-07").days).toBe(366);
  });

  it("computes percentage change with no infinite deltas", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(70_000, 42_000)).toBe(66.7);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(0, 10)).toBe(-100);
  });
});

describe("business hours", () => {
  const hours = [
    { day: 1, closed: false, open: "09:00", close: "17:30" },
    { day: 5, closed: false, open: "18:00", close: "02:00" },
    { day: 0, closed: true, open: "00:00", close: "00:00" },
    { day: 6, closed: false, open: "00:00", close: "00:00" },
  ];

  it("handles regular, overnight, closed, 24h and missing days", () => {
    expect(openMinutesForWeekday(hours, 1)).toBe(510);
    expect(openMinutesForWeekday(hours, 5)).toBe(480);
    expect(openMinutesForWeekday(hours, 0)).toBe(0);
    expect(openMinutesForWeekday(hours, 6)).toBe(1440);
    expect(openMinutesForWeekday(hours, 3)).toBe(DEFAULT_OPEN_MINUTES_PER_DAY);
    expect(openMinutesForWeekday([], 3)).toBe(DEFAULT_OPEN_MINUTES_PER_DAY);
  });

  it("sums a range and computes capped occupancy", () => {
    // 2026-03-01 is a Sunday (closed), 2026-03-02 a Monday.
    expect(openMinutesInRange(hours, "2026-03-01", "2026-03-02")).toBe(510);
    expect(occupancyPercent(240, 2, 5040)).toBe(2.4);
    expect(occupancyPercent(99_999, 1, 60)).toBe(100);
    expect(occupancyPercent(10, 0, 60)).toBeNull();
  });
});

describe("branch report access", () => {
  const grants = (
    branch: Record<string, Permission[]>,
    restaurant: Record<string, Permission[]> = {},
  ): AccessGrants => ({
    workspace: new Set<Permission>(["workspace.view"]),
    restaurants: new Map(Object.entries(restaurant).map(([k, v]) => [k, new Set(v)])),
    branches: new Map(Object.entries(branch).map(([k, v]) => [k, new Set(v)])),
  });

  it("honours restaurant-wide and branch-level reports.view only where granted", () => {
    const g = grants({ b1: ["branch.view", "reports.view"], b2: ["branch.view"] });
    expect(canViewBranchReports(g, { restaurantId: "r1", branchId: "b1" })).toBe(true);
    expect(canViewBranchReports(g, { restaurantId: "r1", branchId: "b2" })).toBe(false);
    const r = grants({}, { r1: ["reports.view"] });
    expect(canViewBranchReports(r, { restaurantId: "r1", branchId: "b9" })).toBe(true);
    expect(canViewBranchReports(r, { restaurantId: "r2", branchId: "b9" })).toBe(false);
  });
});

describe("workspace classification", () => {
  const policy = { graceDays: 7, restrictedMode: "READ_ONLY" as const };
  const now = new Date("2026-03-10T00:00:00Z");
  const plan = { id: "p", key: "pro", name: "Pro", limits: {} as never, features: [] };
  const sub = (status: "TRIALING" | "ACTIVE" | "EXPIRED", end: string | null) => ({
    status,
    trialStartsAt: new Date("2026-02-01T00:00:00Z"),
    trialEndsAt: status === "ACTIVE" ? null : end ? new Date(end) : null,
    currentPeriodEnd: status === "ACTIVE" && end ? new Date(end) : null,
    cancelledAt: null,
  });

  it("separates trials, expired trials, paid and suspended workspaces", () => {
    const trial = classifyWorkspace(
      { workspaceStatus: "ACTIVE", subscription: sub("TRIALING", "2026-03-20"), plan },
      policy,
      now,
    );
    expect(trial).toEqual({ phase: "TRIAL", trial: true, expiredTrial: false, paid: false });
    const lapsed = classifyWorkspace(
      { workspaceStatus: "ACTIVE", subscription: sub("TRIALING", "2026-03-05"), plan },
      policy,
      now,
    );
    expect(lapsed).toMatchObject({ phase: "GRACE", expiredTrial: true });
    const paid = classifyWorkspace(
      { workspaceStatus: "ACTIVE", subscription: sub("ACTIVE", "2026-04-01"), plan },
      policy,
      now,
    );
    expect(paid).toMatchObject({ phase: "ACTIVE", paid: true });
    const suspended = classifyWorkspace(
      { workspaceStatus: "SUSPENDED", subscription: sub("ACTIVE", "2026-04-01"), plan },
      policy,
      now,
    );
    expect(suspended).toMatchObject({ phase: "SUSPENDED", paid: false });
  });

  it("computes conversion rates", () => {
    expect(conversionRate(1, 2)).toBe(50);
    expect(conversionRate(1, 3)).toBe(33.3);
    expect(conversionRate(0, 0)).toBeNull();
  });
});
