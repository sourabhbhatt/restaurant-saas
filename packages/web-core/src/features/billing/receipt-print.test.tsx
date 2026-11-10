import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { BillDto } from "@ros/contracts/billing";
import type { ReceiptDto } from "@ros/contracts/billing-extra";

import { billingKeys } from "./queries";
import { ReceiptPrint } from "./receipt-print";

const BILL = "44444444-4444-4444-8444-444444444444";
let billId = BILL;
vi.mock("next/navigation", () => ({ useParams: () => ({ billId }) }));

const paidBill = {
  id: BILL,
  billNumber: 12,
  tableName: "T4",
  status: "CLOSED",
  paymentStatus: "PAID",
  currency: "INR",
  issuedAt: "2026-11-10T08:30:00.000Z",
  subtotal: 24000,
  discountAmount: 2400,
  serviceChargeBps: 500,
  serviceChargeAmount: 1080,
  taxes: [{ name: "GST", rateBps: 500, amount: 1134 }],
  taxTotal: 1134,
  grandTotal: 23814,
  pricesIncludeTax: false,
  discount: { type: "PERCENT", value: 1000, reason: "Regular" },
  amountPaid: 23814,
  amountRefunded: 500,
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
    { id: "p1", kind: "PAYMENT", method: "UPI", amount: 23814, status: "CONFIRMED" },
    { id: "p2", kind: "PAYMENT", method: "CASH", amount: 500, status: "VOIDED" },
    { id: "p3", kind: "REFUND", method: "UPI", amount: 500, status: "CONFIRMED" },
  ],
} as unknown as BillDto;

const receiptFor = (bill: BillDto): ReceiptDto => ({
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
});

function renderReceipt(bill: BillDto = paidBill) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(billingKeys.receipt(BILL), receiptFor(bill));
  return render(
    <QueryClientProvider client={qc}>
      <ReceiptPrint />
    </QueryClientProvider>,
  );
}

/** The value printed next to a label in the totals list. */
const amountFor = (label: RegExp) => {
  const term = screen.getAllByRole("term").find((dt) => label.test(dt.textContent ?? ""));
  return term?.nextElementSibling?.textContent;
};

describe("ReceiptPrint", () => {
  it("prints the business details, items, totals, tax and confirmed payments", () => {
    billId = BILL;
    renderReceipt();
    expect(screen.getByRole("heading", { level: 1, name: "Dosa Corner" })).toBeInTheDocument();
    expect(screen.getByText("GSTIN 27ABCDE1234F1Z5")).toBeInTheDocument();
    expect(screen.getByText("#12")).toBeInTheDocument();
    expect(screen.getByText(/Masala Dosa/)).toBeInTheDocument();
    expect(amountFor(/^Subtotal/)).toBe("₹240.00");
    expect(amountFor(/^Discount/)).toMatch(/24\.00/);
    expect(amountFor(/^Service charge/)).toBe("₹10.80");
    expect(amountFor(/^GST/)).toBe("₹11.34");
    expect(amountFor(/^Grand total/)).toBe("₹238.14");
    expect(amountFor(/^Paid/)).toBe("₹238.14");
    expect(amountFor(/^Refunded/)).toMatch(/5\.00/);
    expect(amountFor(/^Balance due/)).toBe("₹0.00");

    const payments = screen.getByRole("region", { name: "Payments" });
    const lines = within(payments)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    // Voided payments are left out; refunds print as negative amounts.
    expect(lines).toEqual(["UPI₹238.14", "Refund · UPI-₹5.00"]);
    expect(screen.queryByText(/not a valid bill/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Print/ })).toBeInTheDocument();
    expect(screen.getByText("Thank you! Please visit again.")).toBeInTheDocument();
  });

  it("marks a voided bill as VOID so it is never handed over as a valid bill", () => {
    billId = BILL;
    renderReceipt({ ...paidBill, status: "VOID", amountPaid: 0, payments: [] } as BillDto);
    const banner = screen.getByRole("note", { name: "Bill status" });
    expect(banner).toHaveTextContent("VOID");
    expect(banner).toHaveTextContent(/not a valid bill/i);
  });

  it("shows the balance due on an unpaid bill", () => {
    billId = BILL;
    renderReceipt({
      ...paidBill,
      status: "ISSUED",
      paymentStatus: "UNPAID",
      amountPaid: 0,
      amountRefunded: 0,
      balanceDue: 23814,
      payments: [],
    } as unknown as BillDto);
    expect(amountFor(/^Balance due/)).toBe("₹238.14");
    expect(screen.queryByRole("region", { name: "Payments" })).not.toBeInTheDocument();
  });

  it("keeps the tax-inclusive note outside the totals list (valid <dl>)", () => {
    billId = BILL;
    const { container } = renderReceipt({ ...paidBill, pricesIncludeTax: true } as BillDto);
    expect(screen.getByText("Menu prices include tax.")).toBeInTheDocument();
    expect(container.querySelector("dl > p")).toBeNull();
  });

  it("explains a malformed link instead of calling the API", () => {
    billId = "not-a-bill";
    renderReceipt();
    expect(
      screen.getByRole("heading", { level: 1, name: "Receipt not found" }),
    ).toBeInTheDocument();
  });
});
