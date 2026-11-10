import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BillDto } from "@ros/contracts/billing";
import type { ReceiptDto } from "@ros/contracts/billing-extra";

import { billingKeys } from "./queries";
import { ReceiptPrint } from "./receipt-print";

const BILL = "44444444-4444-4444-8444-444444444444";
let billId = BILL;
vi.mock("next/navigation", () => ({ useParams: () => ({ billId }) }));

const bill = {
  id: BILL,
  billNumber: 12,
  tableName: "T4",
  currency: "INR",
  issuedAt: "2026-11-10T08:30:00.000Z",
  subtotal: 24000,
  discountAmount: 0,
  serviceChargeBps: 0,
  serviceChargeAmount: 0,
  taxes: [{ name: "GST", rateBps: 500, amount: 1200 }],
  taxTotal: 1200,
  grandTotal: 25200,
  pricesIncludeTax: false,
  discount: null,
  amountPaid: 25200,
  amountRefunded: 0,
  balanceDue: 0,
  items: [
    {
      orderNumber: 3,
      name: "Masala Dosa",
      variantName: null,
      addonsSummary: null,
      quantity: 2,
      unitPrice: 12000,
      lineTotal: 24000,
    },
  ],
  payments: [
    { id: "p1", kind: "PAYMENT", method: "UPI", amount: 25200, status: "CONFIRMED" },
    { id: "p2", kind: "PAYMENT", method: "CASH", amount: 500, status: "VOIDED" },
  ],
} as unknown as BillDto;

const receipt: ReceiptDto = {
  bill,
  restaurantName: "Dosa Corner",
  branchName: "Baner",
  legalName: "Sharma Foods Pvt Ltd",
  taxId: "27ABCDE1234F1Z5",
  addressLines: ["12 Baner Road", "Pune 411045"],
  phone: "+91 98765 43210",
  timezone: "Asia/Kolkata",
  receiptHeader: null,
  receiptFooter: null,
};

function renderReceipt() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(billingKeys.receipt(BILL), receipt);
  return render(
    <QueryClientProvider client={qc}>
      <ReceiptPrint />
    </QueryClientProvider>,
  );
}

describe("ReceiptPrint", () => {
  it("prints the business details, items, tax and confirmed payments", () => {
    billId = BILL;
    renderReceipt();
    expect(screen.getByRole("heading", { level: 1, name: "Dosa Corner" })).toBeInTheDocument();
    expect(screen.getByText("GSTIN 27ABCDE1234F1Z5")).toBeInTheDocument();
    expect(screen.getByText("#12")).toBeInTheDocument();
    expect(screen.getByText(/Masala Dosa/)).toBeInTheDocument();
    const payments = screen.getByRole("region", { name: "Payments" });
    expect(payments).toHaveTextContent("UPI");
    expect(payments).not.toHaveTextContent("Cash");
    expect(screen.getByRole("button", { name: /Print/ })).toBeInTheDocument();
    expect(screen.getByText("Thank you! Please visit again.")).toBeInTheDocument();
  });

  it("explains a malformed link instead of calling the API", () => {
    billId = "not-a-bill";
    renderReceipt();
    expect(
      screen.getByRole("heading", { level: 1, name: "Receipt not found" }),
    ).toBeInTheDocument();
  });
});
