import type { ReactNode } from "react";

import type { BillItemDto, BillTotalsDto } from "@ros/contracts/billing";
import { cn } from "@ros/ui/utils";

import { bpsLabel, money } from "../format";

interface Props {
  totals: BillTotalsDto;
  items: BillItemDto[];
  currency: string;
  discountLabel?: string | null;
  /** Show paid / balance rows (issued bills). */
  paid?: { amountPaid: number; amountRefunded: number; balanceDue: number } | null;
  size?: "default" | "large";
  className?: string;
}

function Row({
  label,
  value,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", className)}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd data-numeric className="tabular-nums">
        {value}
      </dd>
    </div>
  );
}

/** Itemised bill with discount, service charge, tax breakdown and totals. */
export function BillBreakdown({
  totals,
  items,
  currency,
  discountLabel,
  paid,
  size = "default",
  className,
}: Props) {
  const m = (v: number) => money(v, currency);
  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <ul className="flex flex-col divide-y rounded-lg border" aria-label="Bill items">
        {items.map((item, i) => (
          <li key={`${item.orderNumber}-${item.name}-${i}`} className="flex gap-3 px-3 py-2.5">
            <span
              data-numeric
              className="w-8 shrink-0 text-sm font-medium text-muted-foreground tabular-nums"
            >
              {item.quantity}×
            </span>
            <div className="min-w-0 flex-1">
              <p className={cn("font-medium", size === "large" && "text-base")}>
                {item.name}
                {item.variantName && (
                  <span className="font-normal text-muted-foreground"> · {item.variantName}</span>
                )}
              </p>
              {item.addonsSummary && (
                <p className="truncate text-xs text-muted-foreground">+ {item.addonsSummary}</p>
              )}
              <p className="text-xs text-muted-foreground tabular-nums">{m(item.unitPrice)} each</p>
            </div>
            <span data-numeric className="shrink-0 font-medium tabular-nums">
              {m(item.lineTotal)}
            </span>
          </li>
        ))}
        {items.length === 0 && (
          <li className="px-3 py-6 text-center text-sm text-muted-foreground">No items</li>
        )}
      </ul>

      <dl className={cn("flex flex-col gap-1.5 text-sm", size === "large" && "text-base")}>
        <Row label="Subtotal" value={m(totals.subtotal)} />
        {totals.discountAmount > 0 && (
          <Row
            label={discountLabel ? `Discount (${discountLabel})` : "Discount"}
            value={`− ${m(totals.discountAmount)}`}
            className="text-success [&_dt]:text-success"
          />
        )}
        {totals.serviceChargeAmount > 0 && (
          <Row
            label={`Service charge (${bpsLabel(totals.serviceChargeBps)})`}
            value={m(totals.serviceChargeAmount)}
          />
        )}
        {totals.taxes.map((t) => (
          <Row
            key={t.name}
            label={`${t.name} (${bpsLabel(t.rateBps)})${totals.pricesIncludeTax ? " incl." : ""}`}
            value={m(t.amount)}
          />
        ))}
        <div
          className={cn(
            "mt-2 flex items-baseline justify-between gap-4 border-t pt-3 font-semibold",
            size === "large" ? "text-2xl" : "text-lg",
          )}
        >
          <dt>Grand total</dt>
          <dd data-numeric className="tabular-nums">
            {m(totals.grandTotal)}
          </dd>
        </div>
        {totals.pricesIncludeTax && (
          <p className="text-xs text-muted-foreground">Menu prices include tax.</p>
        )}
        {paid && (
          <>
            <Row label="Paid" value={m(paid.amountPaid)} className="mt-2" />
            {paid.amountRefunded > 0 && (
              <Row label="Refunded" value={`− ${m(paid.amountRefunded)}`} />
            )}
            <div
              className={cn(
                "flex items-baseline justify-between gap-4 font-semibold",
                size === "large" ? "text-xl" : "text-base",
                paid.balanceDue > 0 ? "text-destructive" : "text-success",
              )}
            >
              <dt>Balance due</dt>
              <dd data-numeric className="tabular-nums">
                {m(paid.balanceDue)}
              </dd>
            </div>
          </>
        )}
      </dl>
    </div>
  );
}

export function discountLabelFor(
  discount: { type: string; value: number } | null,
  currency: string,
) {
  if (!discount) return null;
  return discount.type === "PERCENT" ? bpsLabel(discount.value) : money(discount.value, currency);
}
