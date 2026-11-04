import { describe, expect, it } from "vitest";

import type { DomainError } from "../shared/errors";
import { priceSelection, startingPrice, type PricedItem } from "./pricing";

const pizza: PricedItem = {
  id: "pizza",
  name: "Margherita Pizza",
  price: 29900,
  discountedPrice: null,
  isAvailable: true,
  variants: [
    { id: "reg", name: "Regular", price: 29900, isAvailable: true },
    { id: "med", name: "Medium", price: 44900, isAvailable: true },
    { id: "lg", name: "Large", price: 59900, isAvailable: false },
  ],
  addonGroups: [
    {
      id: "top",
      name: "Toppings",
      minSelect: 0,
      maxSelect: 2,
      addons: [
        { id: "cheese", name: "Extra Cheese", price: 6000, isAvailable: true },
        { id: "olives", name: "Olives", price: 4000, isAvailable: true },
        { id: "jal", name: "Jalapenos", price: 3500, isAvailable: true },
      ],
    },
  ],
};

const errorsOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as DomainError).fieldErrors ?? {};
  }
  throw new Error("expected to throw");
};

describe("priceSelection", () => {
  it("prices variant + add-ons × quantity", () => {
    const line = priceSelection(pizza, {
      variantId: "med",
      addonIds: ["cheese", "olives"],
      quantity: 2,
    });
    expect(line.unitPrice).toBe(44900 + 6000 + 4000);
    expect(line.lineTotal).toBe(2 * 54900);
    expect(line.variantName).toBe("Medium");
    expect(line.addons.map((a) => a.name)).toEqual(["Extra Cheese", "Olives"]);
  });

  it("requires a variant when the item has variants", () => {
    expect(errorsOf(() => priceSelection(pizza, { quantity: 1 }))).toHaveProperty("variantId");
  });

  it("rejects unavailable variants and too many add-ons", () => {
    expect(errorsOf(() => priceSelection(pizza, { variantId: "lg", quantity: 1 }))).toHaveProperty(
      "variantId",
    );
    const e = errorsOf(() =>
      priceSelection(pizza, {
        variantId: "reg",
        addonIds: ["cheese", "olives", "jal"],
        quantity: 1,
      }),
    );
    expect(e["addonGroups.top"]?.[0]).toMatch(/at most 2/);
  });

  it("enforces required groups and rejects unknown add-ons", () => {
    const item: PricedItem = {
      ...pizza,
      variants: [],
      addonGroups: [{ ...pizza.addonGroups[0]!, minSelect: 1 }],
    };
    expect(errorsOf(() => priceSelection(item, { quantity: 1 }))).toHaveProperty([
      "addonGroups.top",
    ]);
    expect(
      errorsOf(() => priceSelection(item, { addonIds: ["cheese", "ghost"], quantity: 1 })),
    ).toHaveProperty("addonIds");
  });

  it("uses the discounted price only when lower", () => {
    const item: PricedItem = { ...pizza, variants: [], addonGroups: [], discountedPrice: 24900 };
    expect(priceSelection(item, { quantity: 1 }).unitPrice).toBe(24900);
    expect(priceSelection({ ...item, discountedPrice: 39900 }, { quantity: 1 }).unitPrice).toBe(
      29900,
    );
  });

  it("validates quantity bounds", () => {
    expect(errorsOf(() => priceSelection(pizza, { variantId: "reg", quantity: 0 }))).toHaveProperty(
      "quantity",
    );
    expect(
      errorsOf(() => priceSelection(pizza, { variantId: "reg", quantity: 100 })),
    ).toHaveProperty("quantity");
  });

  it("computes starting price from cheapest available variant", () => {
    expect(startingPrice(pizza)).toBe(29900);
  });
});
