"use client";

import { BellRing, Plus, Receipt } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { EmptyState, ErrorState, LoadingState, StatusBadge } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { BranchTableDto } from "@/contracts/staff-ops";
import { formatMoney } from "@/domain/shared/money";
import { errorMessage } from "@/lib/api-client";
import { OrderActionButtons } from "@/features/orders/order-actions";
import { OrderItemsList, OrderStatusBadge, PriorityBadge } from "@/features/orders/order-ui";
import { formatClock, formatElapsed } from "@/features/orders/use-now";

import { AddItemsDialog } from "./add-items-dialog";
import { GenerateBillDialog } from "./generate-bill-dialog";
import { useSessionDetail } from "./queries";
import { TABLE_STATUS_META } from "./table-status";

/** Table drawer: session orders, add items, and bill generation. */
export function TableDrawer({
  branchId,
  table,
  currency,
  can,
  now,
  pollInterval,
  onOpenChange,
}: {
  branchId: string;
  table: BranchTableDto | null;
  currency: string;
  can: (permission: string) => boolean;
  now: number;
  pollInterval: number;
  onOpenChange: (open: boolean) => void;
}) {
  const sessionId = table?.session?.id ?? null;
  const detail = useSessionDetail(branchId, sessionId, pollInterval);
  const [adding, setAdding] = useState(false);
  const [billing, setBilling] = useState(false);
  const meta = table ? TABLE_STATUS_META[table.status] : null;
  const bill = detail.data?.bill ?? table?.bill ?? null;
  const billable = table?.session?.billableSubtotal ?? 0;

  const canAdd = Boolean(table?.isActive) && can("orders.create");
  const canBill = Boolean(sessionId) && !bill && billable > 0 && can("bills.generate");

  return (
    <Sheet open={table !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(100%-1rem,30rem)] sm:max-w-none">
        <SheetHeader>
          <SheetTitle className="text-xl">{table?.tableName ?? "Table"}</SheetTitle>
          <SheetDescription asChild>
            <div className="flex flex-wrap items-center gap-2">
              {meta && (
                <StatusBadge tone={meta.tone}>
                  {table?.status === "BILL_REQUESTED" && <BellRing aria-hidden />}
                  {meta.label}
                </StatusBadge>
              )}
              {table?.session && (
                <span>
                  Open {formatElapsed(table.session.openedAt, now)} · since{" "}
                  {formatClock(table.session.openedAt)}
                </span>
              )}
            </div>
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-4">
          {bill && (
            <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/40 p-3 text-sm">
              <div>
                <p className="font-semibold">Bill #{bill.billNumber}</p>
                <p className="text-muted-foreground">
                  {bill.paymentStatus.replace("_", " ").toLowerCase()} · total{" "}
                  {formatMoney(bill.grandTotal, bill.currency)}
                </p>
              </div>
              <p className="text-right font-semibold tabular-nums">
                Due {formatMoney(bill.balanceDue, bill.currency)}
              </p>
            </div>
          )}
          {!sessionId ? (
            <EmptyState
              size="compact"
              title={table?.isActive ? "No guests at this table" : "Table out of service"}
              description={
                table?.isActive
                  ? "Orders appear here once guests scan the QR code or you add items."
                  : "A manager has disabled this table."
              }
            />
          ) : detail.isPending ? (
            <LoadingState label="Loading table…" />
          ) : detail.isError ? (
            <ErrorState
              size="compact"
              message={errorMessage(detail.error)}
              onRetry={() => void detail.refetch()}
            />
          ) : detail.data.orders.length === 0 ? (
            <EmptyState size="compact" title="No orders yet" />
          ) : (
            <ul className="flex flex-col gap-3">
              {detail.data.orders.map((o) => (
                <li key={o.id} className="flex flex-col gap-2 rounded-xl border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">
                      #{o.orderNumber}{" "}
                      <span className="text-xs font-normal text-muted-foreground">
                        {formatClock(o.createdAt)}
                      </span>
                    </span>
                    <div className="flex gap-1">
                      <PriorityBadge priority={o.priority} />
                      <OrderStatusBadge status={o.status} />
                    </div>
                  </div>
                  <OrderItemsList items={o.items} />
                  {o.rejectionReason && (
                    <p className="text-xs text-destructive">Rejected: {o.rejectionReason}</p>
                  )}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm tabular-nums text-muted-foreground">
                      {formatMoney(o.subtotal, o.currency)}
                    </span>
                    <OrderActionButtons
                      branchId={branchId}
                      order={o}
                      can={can}
                      only={["accept", "reject", "serve"]}
                      size="sm"
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SheetBody>
        {table && (canAdd || canBill || bill) && (
          <SheetFooter className="flex-row flex-wrap">
            {canAdd && (
              <Button className="flex-1" size="lg" onClick={() => setAdding(true)}>
                <Plus aria-hidden /> Add items
              </Button>
            )}
            {canBill && (
              <Button className="flex-1" size="lg" variant="outline" onClick={() => setBilling(true)}>
                <Receipt aria-hidden /> Generate bill
              </Button>
            )}
            {bill && can("bills.view") && (
              <Button className="flex-1" size="lg" variant="outline" asChild>
                <Link href={`/app/b/${branchId}/bills`}>
                  <Receipt aria-hidden /> View bill
                </Link>
              </Button>
            )}
          </SheetFooter>
        )}
        {table && canAdd && (
          <AddItemsDialog
            key={table.tableId}
            branchId={branchId}
            tableId={table.tableId}
            tableName={table.tableName}
            currency={currency}
            open={adding}
            onOpenChange={setAdding}
          />
        )}
        {table && sessionId && can("bills.generate") && (
          <GenerateBillDialog
            key={sessionId}
            branchId={branchId}
            sessionId={sessionId}
            tableName={table.tableName}
            currency={currency}
            canDiscount={can("bills.discount")}
            open={billing}
            onOpenChange={setBilling}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
