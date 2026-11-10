"use client";

import { PAYMENT_METHODS } from "@ros/domain/billing/payments";
import { Skeleton } from "@ros/ui/ui/skeleton";
import { Button } from "@ros/ui/ui/button";
import { errorMessage } from "@ros/api-client";
import { cn } from "@ros/ui/utils";

import { METHOD_LABEL, money } from "../format";
import { usePaymentSummary } from "../queries";

/** Compact "today's collections by method" strip (cashier console header). */
export function PaymentSummaryStrip({
  branchId,
  className,
}: {
  branchId: string;
  className?: string;
}) {
  const summary = usePaymentSummary(branchId);

  if (summary.isPending) {
    return (
      <div className={cn("flex gap-3", className)} aria-busy>
        <span className="sr-only">Loading today&apos;s collections</span>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-24" />
        ))}
      </div>
    );
  }
  if (summary.isError) {
    return (
      <div className={cn("flex items-center gap-2 text-sm text-muted-foreground", className)}>
        <span>Collections unavailable: {errorMessage(summary.error)}</span>
        <Button variant="ghost" size="xs" onClick={() => void summary.refetch()}>
          Retry
        </Button>
      </div>
    );
  }
  const s = summary.data;
  const cells = [
    { label: "Collected today", value: s.totalCollected, strong: true },
    ...PAYMENT_METHODS.filter((m) => s.byMethod[m] !== 0 || m !== "OTHER").map((m) => ({
      label: METHOD_LABEL[m],
      value: s.byMethod[m],
      strong: false,
    })),
    ...(s.refunds ? [{ label: "Refunds", value: -s.refunds, strong: false }] : []),
    { label: "Outstanding", value: s.outstanding, strong: false },
  ];
  return (
    <dl
      className={cn("flex gap-x-5 gap-y-1 overflow-x-auto text-sm whitespace-nowrap", className)}
      aria-label="Today's collections"
      // Scrolls sideways on narrow screens: keyboard users must be able to reach it.
      tabIndex={0}
    >
      {cells.map((cell) => (
        <div key={cell.label} className="flex flex-col">
          <dt className="text-xs text-muted-foreground">{cell.label}</dt>
          <dd
            data-numeric
            className={cn("tabular-nums", cell.strong ? "text-base font-semibold" : "font-medium")}
          >
            {money(cell.value, s.currency)}
          </dd>
        </div>
      ))}
    </dl>
  );
}
