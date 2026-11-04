import { describe, expect, it } from "vitest";

import {
  allowedPermissionsForScope,
  branchSettingsSchema,
  createInvitationSchema,
  createRoleSchema,
} from "@/contracts/tenancy";

import { baseBranchCode, customRoleKey, lastOwnerViolation, nextFreeBranchCode } from "./rules";

describe("branch codes", () => {
  it("derives an upper-case code from the name", () => {
    expect(baseBranchCode("Koramangala")).toBe("KORAMANG");
    expect(baseBranchCode("MG Road")).toBe("MGROAD");
    expect(baseBranchCode("Café Été")).toBe("CAFEETE");
    expect(baseBranchCode("#1")).toBe("BR1");
  });

  it("picks the first free suffix", () => {
    expect(nextFreeBranchCode("MAIN", [])).toBe("MAIN");
    expect(nextFreeBranchCode("MAIN", ["main", "MAIN-2"])).toBe("MAIN-3");
  });
});

describe("last owner protection", () => {
  it("blocks demoting, disabling or removing the only owner", () => {
    for (const change of ["demote", "disable", "remove"] as const) {
      expect(
        lastOwnerViolation({ targetIsActiveOwner: true, change, activeOwnerCount: 1 }),
      ).not.toBeNull();
    }
  });
  it("allows it when another owner remains, or the target is not an owner", () => {
    expect(
      lastOwnerViolation({ targetIsActiveOwner: true, change: "demote", activeOwnerCount: 2 }),
    ).toBeNull();
    expect(
      lastOwnerViolation({ targetIsActiveOwner: false, change: "remove", activeOwnerCount: 1 }),
    ).toBeNull();
  });
});

describe("contracts", () => {
  it("limits role permissions to the role scope", () => {
    expect(allowedPermissionsForScope("BRANCH").every((p) => !p.startsWith("workspace."))).toBe(
      true,
    );
    const bad = createRoleSchema.safeParse({
      name: "Floor lead",
      scope: "BRANCH",
      permissions: ["orders.view", "menu.manage"],
    });
    expect(bad.success).toBe(false);
    const ok = createRoleSchema.safeParse({
      name: "Floor lead",
      scope: "BRANCH",
      permissions: ["orders.view", "orders.view", "orders.approve"],
    });
    expect(ok.success && ok.data.permissions).toEqual(["orders.view", "orders.approve"]);
  });

  it("validates branch settings totals and payment methods", () => {
    const base = {
      taxes: [{ name: "GST", rateBps: 500 }],
      pricesIncludeTax: false,
      serviceChargeBps: 0,
      paymentMethods: ["CASH"],
      requireFullPaymentToClose: true,
      autoCompleteOnPayment: true,
      allowCustomerBillRequest: true,
      acceptingOrders: true,
      kitchenDelayMinutes: 20,
      kitchenSoundEnabled: true,
      waiterSoundEnabled: true,
    };
    expect(branchSettingsSchema.safeParse(base).success).toBe(true);
    expect(branchSettingsSchema.safeParse({ ...base, paymentMethods: [] }).success).toBe(false);
    expect(
      branchSettingsSchema.safeParse({
        ...base,
        taxes: [
          { name: "A", rateBps: 6000 },
          { name: "B", rateBps: 6000 },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires a role when an invitation targets a restaurant", () => {
    const r = createInvitationSchema.safeParse({
      email: "A@Example.com",
      workspaceRoleId: "6f1c3a0e-8a3b-4c1e-9a55-0f2d1c3b4a5e",
      restaurantId: "6f1c3a0e-8a3b-4c1e-9a55-0f2d1c3b4a5f",
      assignmentRoleId: "",
    });
    expect(r.success).toBe(false);
    const ok = createInvitationSchema.safeParse({
      email: "A@Example.com",
      workspaceRoleId: "6f1c3a0e-8a3b-4c1e-9a55-0f2d1c3b4a5e",
      restaurantId: "",
      branchId: "",
      assignmentRoleId: "",
    });
    expect(ok.success && ok.data.email).toBe("a@example.com");
  });

  it("builds custom role keys", () => {
    expect(customRoleKey("Head Chef!", "ab12")).toBe("custom_head_chef_ab12");
  });
});
