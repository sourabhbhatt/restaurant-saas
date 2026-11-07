import { describe, expect, it } from "vitest";

import { pathForBranch } from "./context-switcher";
import { adminNav, branchNav, requiredPermissionFor, workspaceNav } from "./nav-config";

describe("pathForBranch", () => {
  it("keeps the current section when the branch changes", () => {
    expect(pathForBranch("/app/b/old/menu", "new")).toBe("/app/b/new/menu");
    expect(pathForBranch("/app/b/old/orders/123", "new")).toBe("/app/b/new/orders/123");
    expect(pathForBranch("/app/b/old", "new")).toBe("/app/b/new");
  });

  it("goes to the branch overview from workspace pages", () => {
    expect(pathForBranch("/app/w/ws1/members", "new")).toBe("/app/b/new");
    expect(pathForBranch("/app/w/ws1", "new")).toBe("/app/b/new");
  });
});

describe("requiredPermissionFor", () => {
  it("uses the permission of the longest matching nav item", () => {
    const nav = branchNav("b1");
    expect(requiredPermissionFor("/app/b/b1/settings", nav)).toBe("branch.update");
    expect(requiredPermissionFor("/app/b/b1/staff", nav)).toBe("staff.manage");
    expect(requiredPermissionFor("/app/b/b1/orders/o-9", nav)).toBe("orders.view");
  });

  it("leaves the overview open and ignores unknown paths", () => {
    expect(requiredPermissionFor("/app/b/b1", branchNav("b1"))).toBeNull();
    expect(requiredPermissionFor("/somewhere/else", workspaceNav("w1"))).toBeNull();
  });

  it("covers nested workspace pages through their section", () => {
    expect(requiredPermissionFor("/app/w/w1/members", workspaceNav("w1"))).toBe(
      "workspace.members.view",
    );
    expect(requiredPermissionFor("/app/w/w1/restaurants/r1", workspaceNav("w1"))).toBe(
      "workspace.view",
    );
  });

  it("admin navigation has no per-item permission (the platform role is checked as a whole)", () => {
    expect(adminNav().every((i) => !i.permission)).toBe(true);
    expect(adminNav().map((i) => i.href)).toContain("/admin/upgrade-requests");
  });
});
