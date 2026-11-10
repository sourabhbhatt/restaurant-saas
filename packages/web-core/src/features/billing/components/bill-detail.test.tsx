import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { BillDto } from "@ros/contracts/billing";

import { BillDetail } from "./bill-detail";

const BILL = "44444444-4444-4444-8444-444444444444";

const bill = {
  id: BILL,
  branchId: "22222222-2222-4222-8222-222222222222",
  billNumber: 7,
  tableName: "T2",
  status: "ISSUED",
  paymentStatus: "UNPAID",
  currency: "INR",
  issuedAt: "2026-11-10T08:30:00.000Z",
  issuedByName: null,
  subtotal: 12000,
  discountAmount: 0,
  serviceChargeBps: 0,
  serviceChargeAmount: 0,
  taxes: [],
  taxTotal: 0,
  grandTotal: 12000,
  pricesIncludeTax: false,
  discount: null,
  amountPaid: 0,
  amountRefunded: 0,
  balanceDue: 12000,
  items: [],
  payments: [],
} as unknown as BillDto;

describe("BillDetail", () => {
  it("prints the receipt on the app the user is signed in to (console and ops both serve it)", () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <BillDetail bill={bill} branchId={bill.branchId} can={() => false} />
      </QueryClientProvider>,
    );
    // Production apps do not share a session cookie, so an absolute link to another
    // origin would send a cashier signed in on ops to the console sign-in page.
    expect(screen.getByRole("link", { name: /Print receipt/ })).toHaveAttribute(
      "href",
      `/print/bills/${BILL}`,
    );
  });
});
