import { describe, expect, it } from "vitest";

import { DomainError } from "../shared/errors";
import type { PricedItem } from "../menu/pricing";
import { priceOrderLines, type MenuCatalogEntry } from "./order-lines";

const tea: PricedItem = {
  id: "tea",
  name: "Masala Chai",
  price: 6_000,
  discountedPrice: 5_000,
  isAvailable: true,
  variants: [],
  addonGroups: [
    {
      id: "g1",
      name: "Extras",
      minSelect: 0,
      maxSelect: 1,
      addons: [
        { id: "ginger", name: "Ginger", price: 1_000, isAvailable: true },
        { id: "honey", name: "Honey", price: 1_500, isAvailable: false },
      ],
    },
  ],
};

const catalog = new Map<string, MenuCatalogEntry>([
  ["tea", { item: tea, categoryName: "Drinks", dietary: "VEG" }],
]);

describe("priceOrderLines", () => {
  it("prices from the catalog and totals the order", () => {
    const out = priceOrderLines(catalog, [
      { menuItemId: "tea", addonIds: ["ginger"], quantity: 2, notes: "  hot  " },
      { menuItemId: "tea", quantity: 1, notes: "   " },
    ]);
    expect(out.subtotal).toBe((5_000 + 1_000) * 2 + 5_000);
    expect(out.itemCount).toBe(3);
    expect(out.lines[0]).toMatchObject({
      categoryName: "Drinks",
      dietary: "VEG",
      unitPrice: 6_000,
      notes: "hot",
    });
    expect(out.lines[1]!.notes).toBeNull();
  });

  it("collects every line's problems under indexed field keys", () => {
    try {
      priceOrderLines(catalog, [
        { menuItemId: "tea", quantity: 1 },
        { menuItemId: "missing", quantity: 1 },
        { menuItemId: "tea", addonIds: ["honey"], quantity: 1 },
      ]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      const fe = (error as DomainError).fieldErrors!;
      expect(Object.keys(fe).sort()).toEqual(["lines.1.menuItemId", "lines.2.addonGroups.g1"]);
    }
  });
});
