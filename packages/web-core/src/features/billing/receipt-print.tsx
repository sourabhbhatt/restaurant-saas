"use client";

import { Printer, Receipt } from "lucide-react";
import { useParams } from "next/navigation";

import { EmptyState, ErrorState, PageSkeleton } from "@ros/ui/shared/feedback";
import { Button } from "@ros/ui/ui/button";
import { errorMessage } from "@ros/api-client";

import { BillBreakdown, discountLabelFor } from "./components/bill-breakdown";
import { formatDateTime, METHOD_LABEL, money } from "./format";
import { useReceipt } from "./queries";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** /print/bills/[billId]: a printable receipt (80 mm thermal or A4), from GET /bills/:id/receipt. */
export function ReceiptPrint() {
  const { billId } = useParams<{ billId: string }>();
  const valid = UUID.test(billId ?? "");
  const q = useReceipt(valid ? billId : undefined);

  if (!valid) {
    return (
      <main id="main" className="mx-auto max-w-lg p-6">
        <EmptyState
          headingLevel={1}
          icon={<Receipt />}
          title="Receipt not found"
          description="Open the bill from Bills or the cashier screen and choose Print receipt."
        />
      </main>
    );
  }
  if (q.isPending) return <PageSkeleton variant="detail" />;
  if (q.isError) {
    return (
      <main id="main" className="mx-auto max-w-lg p-6">
        <ErrorState
          title="Couldn't load the receipt"
          message={errorMessage(q.error)}
          onRetry={() => void q.refetch()}
          retrying={q.isFetching}
        />
      </main>
    );
  }

  const r = q.data;
  const b = r.bill;
  const payments = b.payments.filter((p) => p.status === "CONFIRMED");
  return (
    <div className="min-h-dvh bg-muted/40 py-6 print:bg-white print:py-0">
      <style>{`@page { margin: 6mm; }`}</style>
      <div className="mx-auto mb-4 flex max-w-sm justify-end px-4 print:hidden">
        <Button onClick={() => window.print()}>
          <Printer aria-hidden /> Print
        </Button>
      </div>
      <main
        id="main"
        className="mx-auto flex max-w-sm flex-col gap-4 bg-white p-6 text-sm text-neutral-900 shadow-sm print:max-w-none print:p-0 print:shadow-none"
      >
        <header className="flex flex-col items-center gap-0.5 text-center">
          <h1 className="text-lg font-bold">{r.restaurantName}</h1>
          <p>{r.branchName}</p>
          {r.legalName ? <p>{r.legalName}</p> : null}
          {r.addressLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
          {r.phone ? <p>Phone {r.phone}</p> : null}
          {r.taxId ? <p>GSTIN {r.taxId}</p> : null}
          {r.receiptHeader ? <p className="mt-2 whitespace-pre-line">{r.receiptHeader}</p> : null}
        </header>
        {b.status === "VOID" ? (
          // Printed too: a voided bill must never pass for a valid one.
          <div
            role="note"
            aria-label="Bill status"
            className="border-2 border-neutral-900 p-2 text-center"
          >
            <p className="text-2xl font-black tracking-[0.3em]">VOID</p>
            <p className="font-semibold">This bill was voided. It is not a valid bill.</p>
          </div>
        ) : null}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 border-y border-dashed py-2">
          <dt>Bill</dt>
          <dd className="text-right tabular-nums">#{b.billNumber}</dd>
          <dt>Table</dt>
          <dd className="text-right">{b.tableName}</dd>
          <dt>Date</dt>
          <dd className="text-right">{formatDateTime(b.issuedAt, r.timezone)}</dd>
        </dl>
        <BillBreakdown
          totals={b}
          items={b.items}
          currency={b.currency}
          discountLabel={discountLabelFor(b.discount, b.currency)}
          paid={{
            amountPaid: b.amountPaid,
            amountRefunded: b.amountRefunded,
            balanceDue: b.balanceDue,
          }}
        />
        {payments.length > 0 ? (
          <section aria-labelledby="receipt-payments" className="flex flex-col gap-1">
            <h2 id="receipt-payments" className="font-semibold">
              Payments
            </h2>
            <ul className="flex flex-col gap-0.5">
              {payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-4">
                  <span>
                    {p.kind === "REFUND" ? "Refund · " : ""}
                    {METHOD_LABEL[p.method] ?? p.method}
                  </span>
                  <span className="tabular-nums">
                    {money(p.kind === "REFUND" ? -p.amount : p.amount, b.currency)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        <footer className="border-t border-dashed pt-2 text-center whitespace-pre-line">
          {r.receiptFooter ?? "Thank you! Please visit again."}
        </footer>
      </main>
    </div>
  );
}
