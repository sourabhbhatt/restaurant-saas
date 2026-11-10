import { describe, expect, it } from "vitest";

import { annualSavingPercent, formatLimit, parsePublicPlans, planPrice } from "./plan-model";

const starter = {
  key: "starter",
  name: "Starter",
  description: "One restaurant",
  currency: "INR",
  monthlyPrice: 49900,
  annualPrice: 499000,
  isTrialEligible: true,
  limits: { maxRestaurants: 1, maxBranches: 1, storageMb: 2048, maxStaff: null },
  features: [
    { key: "qr_ordering", label: "QR table ordering" },
    { key: "not_a_feature", label: "Unknown" },
  ],
};
const enterprise = { ...starter, key: "enterprise", monthlyPrice: null, annualPrice: null };

describe("parsePublicPlans", () => {
  it("parses the PublicPlanDto[] contract and drops unknown feature keys", () => {
    const { plans, trialDays } = parsePublicPlans([starter, enterprise]);
    expect(trialDays).toBeNull();
    expect(plans).toHaveLength(2);
    expect(plans[0]!.features).toEqual(["qr_ordering"]);
    expect(plans[0]!.limits).toMatchObject({ maxRestaurants: 1, maxStaff: null });
  });

  it("accepts a { plans, trialDays } envelope and bare feature keys", () => {
    const res = parsePublicPlans({
      plans: [{ ...starter, features: ["kitchen_display"] }],
      trialDays: 30,
    });
    expect(res.trialDays).toBe(30);
    expect(res.plans[0]!.features).toEqual(["kitchen_display"]);
  });

  it("throws on an unexpected shape so the UI shows its error state", () => {
    expect(() => parsePublicPlans({ nope: true })).toThrow();
  });
});

describe("pricing helpers", () => {
  const [plan, custom] = parsePublicPlans([starter, enterprise]).plans;

  it("formats monthly and annual prices", () => {
    expect(planPrice(plan!, "monthly")).toMatchObject({ amount: "₹499", period: "/month" });
    // The yearly price is visible in the monthly view too (it is also in the JSON-LD offers).
    expect(planPrice(plan!, "monthly").note).toBe("or ₹4,990 billed yearly");
    const annual = planPrice(plan!, "annual");
    expect(annual).toMatchObject({ amount: "₹4,990", period: "/year" });
    expect(annual.note).toContain("₹416");
  });

  it("treats null prices as custom pricing", () => {
    expect(planPrice(custom!, "monthly").amount).toBeNull();
    expect(planPrice(custom!, "annual").amount).toBeNull();
  });

  it("computes the annual saving", () => {
    expect(annualSavingPercent(plan!)).toBe(17);
    expect(annualSavingPercent(custom!)).toBeNull();
  });

  it("formats limits", () => {
    expect(formatLimit("maxStaff", null)).toBe("Unlimited");
    expect(formatLimit("storageMb", 2048)).toBe("2 GB");
    expect(formatLimit("storageMb", 200)).toBe("200 MB");
    expect(formatLimit("maxBranches", undefined)).toBe("—");
  });
});
