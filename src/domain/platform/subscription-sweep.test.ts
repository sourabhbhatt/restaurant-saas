import { describe, expect, it } from "vitest";

import { addDays } from "../subscriptions/entitlements";
import {
  extendedTrialEnd,
  periodEndFromDate,
  planSubscriptionSweep,
  remindersAfterExtension,
  SWEEP_SENTINELS,
} from "./subscription-sweep";

const start = new Date("2026-01-01T00:00:00Z");
const policy = { trialReminderDays: [7, 15, 25], graceDays: 7 };
const trial = (remindersSent: number[] = []) => ({
  status: "TRIALING" as const,
  trialStartsAt: start,
  trialEndsAt: addDays(start, 30),
  currentPeriodEnd: null,
  remindersSent,
});

describe("planSubscriptionSweep", () => {
  it("sends nothing before the first reminder day", () => {
    const d = planSubscriptionSweep(trial(), policy, addDays(start, 3));
    expect(d.changed).toBe(false);
    expect(d.reminderDay).toBeNull();
  });

  it("sends a due reminder once with days left", () => {
    const d = planSubscriptionSweep(trial(), policy, addDays(start, 7.5));
    expect(d.reminderDay).toBe(7);
    expect(d.trialDaysLeft).toBe(23);
    expect(d.nextRemindersSent).toEqual([7]);
    const again = planSubscriptionSweep(trial(d.nextRemindersSent), policy, addDays(start, 8));
    expect(again.changed).toBe(false);
  });

  it("collapses missed reminders into the latest one", () => {
    const d = planSubscriptionSweep(trial(), policy, addDays(start, 16));
    expect(d.reminderDay).toBe(15);
    expect(d.nextRemindersSent).toEqual([7, 15]);
  });

  it("marks trial expiry once and skips stale reminders", () => {
    const d = planSubscriptionSweep(trial([7]), policy, addDays(start, 31));
    expect(d.reminderDay).toBeNull();
    expect(d.trialExpired).toBe(true);
    expect(d.graceEnded).toBe(false);
    expect(d.nextRemindersSent).toEqual([7, 15, 25, SWEEP_SENTINELS.TRIAL_EXPIRED]);
    const again = planSubscriptionSweep(trial(d.nextRemindersSent), policy, addDays(start, 32));
    expect(again.changed).toBe(false);
  });

  it("marks grace end after the grace period", () => {
    const d = planSubscriptionSweep(
      trial([7, 15, 25, SWEEP_SENTINELS.TRIAL_EXPIRED]),
      policy,
      addDays(start, 38),
    );
    expect(d.graceEnded).toBe(true);
    expect(d.trialExpired).toBe(false);
  });

  it("marks paid period expiry once", () => {
    const sub = {
      status: "ACTIVE" as const,
      trialStartsAt: null,
      trialEndsAt: null,
      currentPeriodEnd: addDays(start, 30),
      remindersSent: [],
    };
    expect(planSubscriptionSweep(sub, policy, addDays(start, 10)).changed).toBe(false);
    const d = planSubscriptionSweep(sub, policy, addDays(start, 31));
    expect(d.periodExpired).toBe(true);
    expect(d.nextRemindersSent).toEqual([SWEEP_SENTINELS.PERIOD_EXPIRED]);
  });

  it("ignores expired subscriptions", () => {
    const d = planSubscriptionSweep({ ...trial(), status: "EXPIRED" }, policy, addDays(start, 100));
    expect(d.changed).toBe(false);
  });
});

describe("trial extension helpers", () => {
  it("extends from the current end while the trial runs", () => {
    const end = addDays(start, 30);
    expect(extendedTrialEnd(end, addDays(start, 10), 5)).toEqual(addDays(start, 35));
  });
  it("extends from now once the trial ended", () => {
    const now = addDays(start, 40);
    expect(extendedTrialEnd(addDays(start, 30), now, 5)).toEqual(addDays(now, 5));
  });
  it("re-arms one-time end notices", () => {
    expect(remindersAfterExtension([7, 15, -1, -3])).toEqual([7, 15]);
  });
  it("parses an inclusive period end date", () => {
    expect(periodEndFromDate("2026-03-31").toISOString()).toBe("2026-03-31T23:59:59.999Z");
  });
});
