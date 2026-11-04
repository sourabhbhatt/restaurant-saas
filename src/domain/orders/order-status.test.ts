import { describe, expect, it } from "vitest";

import {
  canTransition,
  isDelayed,
  nextOrderStatus,
  ORDER_STATUSES,
  ORDER_TRANSITIONS,
  type OrderAction,
} from "./order-status";

describe("order state machine", () => {
  it("follows the happy path PENDING → COMPLETED", () => {
    let s = nextOrderStatus("PENDING", "accept");
    s = nextOrderStatus(s, "start");
    s = nextOrderStatus(s, "ready");
    s = nextOrderStatus(s, "serve");
    expect(nextOrderStatus(s, "complete")).toBe("COMPLETED");
  });

  it("never lets a pending order reach the kitchen without acceptance", () => {
    expect(canTransition("PENDING", "start")).toBe(false);
    expect(canTransition("PENDING", "ready")).toBe(false);
    expect(() => nextOrderStatus("PENDING", "start")).toThrow(/Cannot start/);
  });

  it("requires a reason to reject or cancel", () => {
    expect(() => nextOrderStatus("PENDING", "reject")).toThrow(/reason/);
    expect(nextOrderStatus("PENDING", "reject", "Out of stock")).toBe("REJECTED");
    expect(() => nextOrderStatus("ACCEPTED", "cancel", " ")).toThrow(/reason/);
  });

  it("allows nothing out of terminal states", () => {
    for (const status of ["COMPLETED", "REJECTED", "CANCELLED"] as const) {
      for (const action of Object.keys(ORDER_TRANSITIONS) as OrderAction[]) {
        expect(canTransition(status, action)).toBe(false);
      }
    }
    expect(ORDER_STATUSES).toHaveLength(8);
  });

  it("detects delayed orders", () => {
    const accepted = new Date("2026-01-01T10:00:00Z");
    expect(isDelayed(accepted, 15, new Date("2026-01-01T10:10:00Z"))).toBe(false);
    expect(isDelayed(accepted, 15, new Date("2026-01-01T10:16:00Z"))).toBe(true);
  });
});
