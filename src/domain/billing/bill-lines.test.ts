import { describe, expect, it } from "vitest";

import { billWarnings, buildBillLines, countSessionOrders, type SnapshotOrder } from "./bill-lines";

const item = (
  over: Partial<SnapshotOrder["items"][number]> = {},
): SnapshotOrder["items"][number] => ({
  id: over.id ?? "i1",
  itemName: "Dish",
  variantName: null,
  quantity: 1,
  unitPrice: 1_000,
  lineTotal: 1_000,
  status: "SERVED",
  sortOrder: 0,
  addons: [],
  ...over,
});

describe("buildBillLines", () => {
  it("bills only billable orders, skips cancelled items and keeps snapshot prices", () => {
    const orders: SnapshotOrder[] = [
      {
        id: "o2",
        orderNumber: 2,
        status: "SERVED",
        items: [
          item({
            id: "b",
            itemName: "Naan",
            sortOrder: 1,
            unitPrice: 600,
            quantity: 2,
            lineTotal: 1_200,
            addons: [
              { groupName: "Extras", addonName: "Butter" },
              { groupName: "Extras", addonName: "Garlic" },
            ],
          }),
          item({ id: "a", itemName: "Curry", sortOrder: 0 }),
          item({ id: "x", itemName: "Lassi", status: "CANCELLED" }),
        ],
      },
      {
        id: "o1",
        orderNumber: 1,
        status: "COMPLETED",
        items: [item({ id: "c", itemName: "Soup" })],
      },
      { id: "o3", orderNumber: 3, status: "PENDING", items: [item({ id: "d" })] },
      { id: "o4", orderNumber: 4, status: "REJECTED", items: [item({ id: "e" })] },
      { id: "o5", orderNumber: 5, status: "CANCELLED", items: [item({ id: "f" })] },
    ];
    const lines = buildBillLines(orders);
    expect(lines.map((l) => l.name)).toEqual(["Soup", "Curry", "Naan"]);
    expect(lines[2]).toMatchObject({
      orderNumber: 2,
      addonsSummary: "Butter, Garlic",
      unitPrice: 600,
      quantity: 2,
      lineTotal: 1_200,
    });
    expect(lines[1]!.addonsSummary).toBeNull();
  });
});

describe("countSessionOrders / billWarnings", () => {
  it("counts pending and in-kitchen orders and warns about them", () => {
    const counts = countSessionOrders([
      { status: "PENDING" },
      { status: "PENDING" },
      { status: "PREPARING" },
      { status: "SERVED" },
      { status: "REJECTED" },
    ]);
    expect(counts).toEqual({
      billableOrderCount: 2,
      pendingOrderCount: 2,
      activeOrderCount: 4,
      inKitchenOrderCount: 1,
    });
    const warnings = billWarnings(counts, 3);
    expect(warnings[0]).toMatch(/^2 orders are still pending approval/);
    expect(warnings[1]).toMatch(/^1 order is still being prepared/);
  });

  it("warns when there is nothing to bill", () => {
    const counts = countSessionOrders([]);
    expect(billWarnings(counts, 0)).toEqual(["There is nothing to bill for this table yet."]);
  });
});
