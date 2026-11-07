import { describe, expect, it } from "vitest";

import { nextUpgradeStatus, UPGRADE_STATUSES, type UpgradeAction } from "./upgrade-request";

describe("upgrade request transitions", () => {
  it("PENDING can be approved, rejected or cancelled", () => {
    expect(nextUpgradeStatus("PENDING", "approve")).toBe("APPROVED");
    expect(nextUpgradeStatus("PENDING", "reject")).toBe("REJECTED");
    expect(nextUpgradeStatus("PENDING", "cancel")).toBe("CANCELLED");
  });

  it("decided requests are final (no double approval, no reopening)", () => {
    for (const from of UPGRADE_STATUSES.filter((s) => s !== "PENDING")) {
      for (const action of ["approve", "reject", "cancel"] as UpgradeAction[]) {
        expect(() => nextUpgradeStatus(from, action)).toThrow(/already/);
      }
    }
  });
});
