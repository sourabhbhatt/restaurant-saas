import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { OrderDto } from "@ros/contracts/orders";

import { WaiterOrderCard } from "./order-card";

const order = {
  id: "o1",
  orderNumber: 12,
  tableId: "t5",
  tableName: "T5",
  status: "PENDING",
  source: "QR",
  priority: "NORMAL",
  createdAt: new Date().toISOString(),
  acceptedAt: null,
  readyAt: null,
  servedAt: null,
  notes: null,
  subtotal: 24000,
  currency: "INR",
  items: [
    {
      id: "i1",
      name: "Masala Dosa",
      quantity: 2,
      status: "PENDING",
      variantName: null,
      addons: [],
      notes: null,
      lineTotal: 24000,
    },
  ],
} as unknown as OrderDto;

describe("WaiterOrderCard", () => {
  it("names the details button by its visible table and order number only", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WaiterOrderCard
          branchId="b1"
          order={order}
          can={() => false}
          now={Date.now()}
          onOpen={() => {}}
        />
      </QueryClientProvider>,
    );
    // Short and still contains the visible label (WCAG 2.5.3), not the whole card body.
    expect(
      screen.getByRole("button", { name: "Open details of order T5 #12" }),
    ).toBeInTheDocument();
  });
});
