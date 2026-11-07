import { describe, expect, it } from "vitest";

import { DEFAULT_PLATFORM_SETTINGS } from "../platform/settings";
import { DomainError } from "../shared/errors";
import {
  assertCanCreateWorkspace,
  effectiveMaxWorkspaces,
  type WorkspaceLimitInput,
} from "./workspace-limit";

const base: WorkspaceLimitInput = {
  phase: "ACTIVE",
  billingCycle: "ANNUAL",
  planMaxWorkspaces: 3,
  overrideMaxWorkspaces: null,
  fairUseMaxWorkspaces: 25,
};
const usage = { currentWorkspaces: 0, createdLast24h: 0, createsPerDay: 5 };

function reasonOf(fn: () => void) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe("LIMIT_REACHED");
    return (e as DomainError).details?.reason;
  }
  return undefined;
}

describe("effectiveMaxWorkspaces", () => {
  it("limits trial, grace and monthly to one workspace", () => {
    expect(effectiveMaxWorkspaces({ ...base, phase: "TRIAL", billingCycle: null })).toBe(1);
    expect(effectiveMaxWorkspaces({ ...base, phase: "GRACE" })).toBe(1);
    expect(effectiveMaxWorkspaces({ ...base, billingCycle: "MONTHLY" })).toBe(1);
  });
  it("gives annual pro its plan limit", () => {
    expect(effectiveMaxWorkspaces(base)).toBe(3);
  });
  it("uses fair use for unlimited plans", () => {
    expect(effectiveMaxWorkspaces({ ...base, planMaxWorkspaces: null })).toBe(25);
  });
  it("lets an override win over everything", () => {
    expect(
      effectiveMaxWorkspaces({ ...base, planMaxWorkspaces: null, overrideMaxWorkspaces: 40 }),
    ).toBe(40);
    expect(
      effectiveMaxWorkspaces({
        ...base,
        phase: "TRIAL",
        billingCycle: null,
        overrideMaxWorkspaces: 2,
      }),
    ).toBe(2);
  });
});

describe("assertCanCreateWorkspace", () => {
  it("allows creation below every limit", () => {
    expect(() =>
      assertCanCreateWorkspace({ ...base, ...usage, currentWorkspaces: 2 }),
    ).not.toThrow();
  });
  it("reports PLAN_LIMIT", () => {
    expect(
      reasonOf(() => assertCanCreateWorkspace({ ...base, ...usage, currentWorkspaces: 3 })),
    ).toBe("PLAN_LIMIT");
  });
  it("reports FAIR_USE for unlimited plans", () => {
    expect(
      reasonOf(() =>
        assertCanCreateWorkspace({
          ...base,
          planMaxWorkspaces: null,
          ...usage,
          currentWorkspaces: 25,
        }),
      ),
    ).toBe("FAIR_USE");
  });
  it("reports DAILY_LIMIT", () => {
    expect(reasonOf(() => assertCanCreateWorkspace({ ...base, ...usage, createdLast24h: 5 }))).toBe(
      "DAILY_LIMIT",
    );
  });
});

describe("default settings", () => {
  it("uses the 15-day trial", () => {
    expect(DEFAULT_PLATFORM_SETTINGS.trialDays).toBe(15);
    expect(DEFAULT_PLATFORM_SETTINGS.trialReminderDays).toEqual([7, 12, 14]);
    expect(DEFAULT_PLATFORM_SETTINGS.fairUseMaxWorkspaces).toBe(25);
    expect(DEFAULT_PLATFORM_SETTINGS.workspaceCreatesPerDay).toBe(5);
    expect(DEFAULT_PLATFORM_SETTINGS.maintenanceMode).toBe(false);
  });
});
