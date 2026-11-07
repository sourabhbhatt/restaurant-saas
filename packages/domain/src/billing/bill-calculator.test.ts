import { describe, expect, it } from "vitest";

import { calculateBill } from "./bill-calculator";
import { assertPaymentAllowed, assertRefundAllowed, computeBalance } from "./payments";

const gst = [
  { name: "CGST", rateBps: 250 },
  { name: "SGST", rateBps: 250 },
];

describe("calculateBill", () => {
  it("adds exclusive taxes on the discounted subtotal plus service charge", () => {
    const t = calculateBill(
      [{ lineTotal: 50000 }, { lineTotal: 30000 }],
      {
        taxes: gst,
        pricesIncludeTax: false,
        serviceChargeBps: 1000,
      },
      { type: "PERCENT", value: 1000 },
    );
    expect(t.subtotal).toBe(80000);
    expect(t.discountAmount).toBe(8000);
    expect(t.netGoods).toBe(72000);
    expect(t.serviceChargeAmount).toBe(7200);
    expect(t.taxableBase).toBe(79200);
    expect(t.taxes.map((x) => x.amount)).toEqual([1980, 1980]);
    expect(t.grandTotal).toBe(79200 + 3960);
  });

  it("extracts inclusive tax so the grand total equals the menu total", () => {
    const t = calculateBill([{ lineTotal: 105000 }], {
      taxes: gst,
      pricesIncludeTax: true,
      serviceChargeBps: 0,
    });
    expect(t.netGoods).toBe(100000);
    expect(t.taxTotal).toBe(5000);
    expect(t.grandTotal).toBe(105000);
  });

  it("caps flat discounts at the subtotal and rejects >100% discounts", () => {
    const t = calculateBill(
      [{ lineTotal: 1000 }],
      { taxes: [], pricesIncludeTax: false, serviceChargeBps: 0 },
      {
        type: "FLAT",
        value: 5000,
      },
    );
    expect(t.grandTotal).toBe(0);
    expect(() =>
      calculateBill(
        [{ lineTotal: 1000 }],
        { taxes: [], pricesIncludeTax: false, serviceChargeBps: 0 },
        {
          type: "PERCENT",
          value: 10001,
        },
      ),
    ).toThrow(/exceed 100%/);
  });

  it("rounds half away from zero per tax line", () => {
    const t = calculateBill([{ lineTotal: 1999 }], {
      taxes: [{ name: "VAT", rateBps: 500 }],
      pricesIncludeTax: false,
      serviceChargeBps: 0,
    });
    expect(t.taxTotal).toBe(100);
  });
});

describe("payments", () => {
  it("derives UNPAID → PARTIALLY_PAID → PAID → REFUNDED from the ledger", () => {
    expect(computeBalance(1000, []).paymentStatus).toBe("UNPAID");
    const partial = computeBalance(1000, [{ kind: "PAYMENT", amount: 400 }]);
    expect(partial).toMatchObject({ paymentStatus: "PARTIALLY_PAID", balanceDue: 600 });
    expect(
      computeBalance(1000, [
        { kind: "PAYMENT", amount: 400 },
        { kind: "PAYMENT", amount: 600 },
      ]).paymentStatus,
    ).toBe("PAID");
    expect(
      computeBalance(1000, [
        { kind: "PAYMENT", amount: 1000 },
        { kind: "REFUND", amount: 1000 },
      ]).paymentStatus,
    ).toBe("REFUNDED");
    expect(
      computeBalance(1000, [{ kind: "PAYMENT", amount: 1000, voided: true }]).paymentStatus,
    ).toBe("UNPAID");
  });

  it("rejects overpayment, zero amounts, and payments on paid bills", () => {
    const b = computeBalance(1000, [{ kind: "PAYMENT", amount: 400 }]);
    expect(() => assertPaymentAllowed(b, 700)).toThrow(/exceeds/);
    expect(() => assertPaymentAllowed(b, 0)).toThrow();
    expect(() =>
      assertPaymentAllowed(computeBalance(1000, [{ kind: "PAYMENT", amount: 1000 }]), 1),
    ).toThrow(/fully paid/);
    expect(() => assertRefundAllowed(b, 500)).toThrow(/exceeds/);
  });
});
