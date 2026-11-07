import { describe, expect, it } from "vitest";

import { addBillingCycle, paidPeriodFor } from "./period";

const at = (iso: string) => new Date(iso);

describe("addBillingCycle", () => {
  it("adds a calendar month and clamps the day", () => {
    expect(addBillingCycle(at("2026-01-31T10:00:00.000Z"), "MONTHLY").toISOString()).toBe(
      "2026-02-28T10:00:00.000Z",
    );
    expect(addBillingCycle(at("2026-03-15T00:00:00.000Z"), "MONTHLY").toISOString()).toBe(
      "2026-04-15T00:00:00.000Z",
    );
  });

  it("adds a calendar year", () => {
    expect(addBillingCycle(at("2028-02-29T00:00:00.000Z"), "ANNUAL").toISOString()).toBe(
      "2029-02-28T00:00:00.000Z",
    );
  });
});

describe("paidPeriodFor", () => {
  const now = at("2026-11-07T12:00:00.000Z");

  it("starts now on a trial, an expired subscription or none", () => {
    for (const current of [
      null,
      { status: "TRIALING" as const, currentPeriodEnd: null },
      { status: "EXPIRED" as const, currentPeriodEnd: at("2026-10-01T00:00:00.000Z") },
    ]) {
      const p = paidPeriodFor(current, "MONTHLY", now);
      expect(p.start).toEqual(now);
      expect(p.end.toISOString()).toBe("2026-12-07T12:00:00.000Z");
    }
  });

  it("renewal extends from the current period end", () => {
    const end = at("2026-11-20T00:00:00.000Z");
    const p = paidPeriodFor({ status: "ACTIVE", currentPeriodEnd: end }, "ANNUAL", now);
    expect(p.start).toEqual(end);
    expect(p.end.toISOString()).toBe("2027-11-20T00:00:00.000Z");
  });

  it("a cancelled period that still runs is not lost either", () => {
    const end = at("2026-11-20T00:00:00.000Z");
    expect(
      paidPeriodFor({ status: "CANCELLED", currentPeriodEnd: end }, "MONTHLY", now).start,
    ).toEqual(end);
  });

  it("an active period already past starts now", () => {
    const p = paidPeriodFor(
      { status: "ACTIVE", currentPeriodEnd: at("2026-11-01T00:00:00.000Z") },
      "MONTHLY",
      now,
    );
    expect(p.start).toEqual(now);
  });
});
