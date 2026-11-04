"use client";

import { ReceiptIcon } from "lucide-react";

import type { GuestBillDto } from "@/contracts/billing";
import type { GuestSessionDto } from "@/contracts/ordering";
import { formatMoney } from "@/domain/shared/money";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/feedback/empty-state";
import { ErrorState } from "@/components/shared/feedback/error-state";
import { errorMessage } from "@/lib/api-client";

const PAYMENT_BADGE: Record<
  GuestBillDto["paymentStatus"],
  { label: string; variant: "warning" | "info" | "success" | "secondary" }
> = {
  UNPAID: { label: "Unpaid", variant: "warning" },
  PARTIALLY_PAID: { label: "Partly paid", variant: "info" },
  PAID: { label: "Paid", variant: "success" },
  REFUNDED: { label: "Refunded", variant: "secondary" },
};

const bps = (v: number) => `${(v / 100).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`;

interface BillViewProps {
  joined: boolean;
  session: GuestSessionDto | undefined;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  onShowOrders: () => void;
}

/** The table's bill once staff issue it (no staff names or payment references). */
export function BillView({
  joined,
  session,
  isPending,
  isError,
  error,
  onRetry,
  onShowOrders,
}: BillViewProps) {
  if (joined && isPending) {
    return (
      <div className="space-y-3 p-4" aria-busy="true" aria-label="Loading your bill">
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (joined && (isError || !session)) {
    return (
      <div className="p-4">
        <ErrorState
          title="Couldn't load the bill"
          message={errorMessage(error)}
          onRetry={onRetry}
        />
      </div>
    );
  }
  const bill = session?.bill ?? null;
  if (!bill) {
    return (
      <EmptyState
        className="mx-4 mt-8"
        icon={<ReceiptIcon />}
        title="Your bill isn't ready yet"
        description={
          session?.session.status === "BILL_REQUESTED"
            ? "You've asked for the bill — a member of staff is preparing it."
            : "Once the staff prepare your table's bill, it will appear here."
        }
        action={
          session?.canRequestBill ? (
            <Button variant="outline" onClick={onShowOrders}>
              Request the bill from My orders
            </Button>
          ) : undefined
        }
      />
    );
  }

  const status = PAYMENT_BADGE[bill.paymentStatus];
  const money = (v: number) => formatMoney(v, bill.currency);

  return (
    <div className="p-4">
      <article
        className="rounded-2xl border bg-card p-4 shadow-xs"
        aria-label={`Bill ${bill.billNumber}`}
      >
        <header className="flex items-start justify-between gap-3 border-b pb-3">
          <div>
            <h2 className="text-lg font-semibold">Bill #{bill.billNumber}</h2>
            <p className="text-sm text-muted-foreground">
              {session?.restaurantName} · {session?.tableName}
            </p>
          </div>
          <Badge variant={status.variant}>{status.label}</Badge>
        </header>

        <table className="mt-3 w-full text-sm">
          <caption className="sr-only">Items on your bill</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {bill.items.map((item, i) => (
              <tr key={i} className="align-top">
                <td className="py-1.5 pr-3">
                  <span className="tabular-nums">{item.quantity}×</span> {item.name}
                  {(item.variantName || item.addonsSummary) && (
                    <span className="block text-xs text-muted-foreground">
                      {[item.variantName, item.addonsSummary].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </td>
                <td className="py-1.5 text-right tabular-nums">{money(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <dl className="mt-3 space-y-1.5 border-t pt-3 text-sm">
          <Row label="Subtotal" value={money(bill.subtotal)} />
          {bill.discountAmount > 0 && (
            <Row label="Discount" value={`− ${money(bill.discountAmount)}`} />
          )}
          {bill.serviceChargeAmount > 0 && (
            <Row
              label={`Service charge (${bps(bill.serviceChargeBps)})`}
              value={money(bill.serviceChargeAmount)}
            />
          )}
          {bill.taxes.map((t) => (
            <Row
              key={t.name}
              label={`${t.name} (${bps(t.rateBps)})${bill.pricesIncludeTax ? " incl." : ""}`}
              value={money(t.amount)}
            />
          ))}
          <div className="flex justify-between border-t pt-2 text-base font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{money(bill.grandTotal)}</dd>
          </div>
          {bill.amountPaid > 0 && <Row label="Paid" value={money(bill.amountPaid)} />}
          <div className="flex justify-between font-semibold">
            <dt>Balance due</dt>
            <dd className="tabular-nums">{money(bill.balanceDue)}</dd>
          </div>
        </dl>
      </article>
      <p className="mt-3 text-center text-sm text-muted-foreground">
        {bill.balanceDue > 0
          ? "Please pay a member of staff or at the counter."
          : "All settled — thank you for dining with us!"}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <dt>{label}</dt>
      <dd className="text-foreground tabular-nums">{value}</dd>
    </div>
  );
}
