import { describe, expect, it } from "vitest";

import { checkSessionClosure, type ClosureState } from "./table-status";

const state = (overrides: Partial<ClosureState> = {}): ClosureState => ({
  activeOrderCount: 0,
  pendingOrderCount: 0,
  inKitchenOrderCount: 0,
  hasBillableOrders: false,
  bill: null,
  ...overrides,
});
const paid = { balanceDue: 0, status: "ISSUED" as const };
const unpaid = { balanceDue: 12_000, status: "ISSUED" as const };
const strict = { requireFullPayment: true };
const lenient = { requireFullPayment: false };

describe("checkSessionClosure", () => {
  it("closes an empty session", () => {
    expect(checkSessionClosure(state(), strict)).toEqual({
      allowed: true,
      reasons: [],
      blockers: [],
    });
  });

  it("pending orders block closing, whatever the bill", () => {
    const check = checkSessionClosure(
      state({ activeOrderCount: 2, pendingOrderCount: 1, hasBillableOrders: true, bill: paid }),
      strict,
    );
    expect(check.allowed).toBe(false);
    expect(check.blockers).toContain("PENDING_ORDERS");
  });

  it("orders still in the kitchen block closing even when the bill is issued and paid", () => {
    // Closing would strand them: the kitchen display lists by status, not by session.
    const check = checkSessionClosure(
      state({ activeOrderCount: 1, inKitchenOrderCount: 1, hasBillableOrders: true, bill: paid }),
      lenient,
    );
    expect(check.allowed).toBe(false);
    expect(check.blockers).toEqual(["ORDERS_IN_KITCHEN"]);
    expect(check.reasons[0]).toMatch(/kitchen|prepar|served/i);
  });

  it("served orders do not block closing", () => {
    const check = checkSessionClosure(
      state({ activeOrderCount: 2, hasBillableOrders: true, bill: paid }),
      strict,
    );
    expect(check).toEqual({ allowed: true, reasons: [], blockers: [] });
  });

  it("billable orders need a live (non-void) bill", () => {
    expect(
      checkSessionClosure(state({ activeOrderCount: 1, hasBillableOrders: true }), strict).blockers,
    ).toEqual(["NO_BILL"]);
    expect(
      checkSessionClosure(
        state({ hasBillableOrders: true, bill: { balanceDue: 0, status: "VOID" } }),
        strict,
      ).blockers,
    ).toEqual(["NO_BILL"]);
  });

  it("an outstanding balance blocks only when the branch requires full payment", () => {
    const due = state({ activeOrderCount: 1, hasBillableOrders: true, bill: unpaid });
    expect(checkSessionClosure(due, strict).blockers).toEqual(["BALANCE_DUE"]);
    expect(checkSessionClosure(due, lenient)).toEqual({ allowed: true, reasons: [], blockers: [] });
  });

  it("reports every blocker at once, in a stable order", () => {
    const check = checkSessionClosure(
      state({
        activeOrderCount: 3,
        pendingOrderCount: 1,
        inKitchenOrderCount: 1,
        hasBillableOrders: true,
        bill: unpaid,
      }),
      strict,
    );
    expect(check.blockers).toEqual(["PENDING_ORDERS", "ORDERS_IN_KITCHEN", "BALANCE_DUE"]);
    expect(check.reasons).toHaveLength(3);
  });
});
