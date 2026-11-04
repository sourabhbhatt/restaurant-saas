import { describe, expect, it } from "vitest";

import { hasPermission, ROLE_TEMPLATES, type AccessGrants, type Permission } from "./permissions";

const grants = (
  opts: Partial<{
    ws: Permission[];
    r: Record<string, Permission[]>;
    b: Record<string, Permission[]>;
  }>,
): AccessGrants => ({
  workspace: new Set(opts.ws ?? []),
  restaurants: new Map(Object.entries(opts.r ?? {}).map(([k, v]) => [k, new Set(v)])),
  branches: new Map(Object.entries(opts.b ?? {}).map(([k, v]) => [k, new Set(v)])),
});

describe("hasPermission", () => {
  it("owner workspace role applies to every restaurant and branch", () => {
    const g = grants({ ws: [...ROLE_TEMPLATES.workspace_owner.permissions] });
    expect(hasPermission(g, "orders.approve", { restaurantId: "r1", branchId: "b1" })).toBe(true);
    expect(hasPermission(g, "workspace.subscription.manage")).toBe(true);
  });

  it("branch grants do not leak to other branches", () => {
    const g = grants({ b: { b1: [...ROLE_TEMPLATES.waiter.permissions] } });
    expect(hasPermission(g, "orders.approve", { restaurantId: "r1", branchId: "b1" })).toBe(true);
    expect(hasPermission(g, "orders.approve", { restaurantId: "r1", branchId: "b2" })).toBe(false);
  });

  it("restaurant grants cover its branches but not workspace permissions", () => {
    const g = grants({ r: { r1: [...ROLE_TEMPLATES.restaurant_manager.permissions] } });
    expect(hasPermission(g, "menu.manage", { restaurantId: "r1" })).toBe(true);
    expect(
      hasPermission(g, "orders.view", { restaurantId: "r1", branchId: "anything-in-r1" }),
    ).toBe(true);
    expect(hasPermission(g, "menu.manage", { restaurantId: "r2" })).toBe(false);
    expect(hasPermission(g, "workspace.members.manage")).toBe(false);
  });

  it("branch-scoped role cannot grant restaurant-scope permissions", () => {
    const g = grants({ b: { b1: ["menu.manage" as Permission] } });
    expect(hasPermission(g, "menu.manage", { restaurantId: "r1", branchId: "b1" })).toBe(false);
  });

  it("templates keep kitchen staff away from payments and waiters away from menus", () => {
    expect(ROLE_TEMPLATES.kitchen_staff.permissions).not.toContain("payments.record");
    expect(ROLE_TEMPLATES.waiter.permissions).not.toContain("menu.manage");
    expect(ROLE_TEMPLATES.cashier.permissions).not.toContain("menu.manage");
  });
});
