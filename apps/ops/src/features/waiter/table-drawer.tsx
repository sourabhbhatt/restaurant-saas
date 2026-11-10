"use client";

import { useQueryClient } from "@tanstack/react-query";
import { BellRing, CloudUpload, DoorClosed, Plus, Receipt } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState, ErrorState, LoadingState, StatusBadge } from "@ros/ui/shared/feedback";
import { Button } from "@ros/ui/ui/button";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@ros/ui/ui/sheet";
import type { BranchTableDto } from "@ros/contracts/staff-ops";
import { formatMoney } from "@ros/domain/shared/money";
import { errorMessage } from "@ros/api-client";
import {
  NeedsConnectionNote,
  queuedStaffOrders,
  useSyncStore,
  type OutboxItem,
} from "@ros/web-core/features/offline";
import { closureReasons, useCloseSession } from "@ros/web-core/features/billing/queries";
import { staffOpsKeys } from "@ros/web-core/features/orders/keys";
import { OrderActionButtons } from "@ros/web-core/features/orders/order-actions";
import {
  OrderItemsList,
  OrderStatusBadge,
  PriorityBadge,
} from "@ros/web-core/features/orders/order-ui";
import { formatClock, formatElapsed } from "@ros/web-core/features/orders/use-now";
import { appHref, useAppLinks } from "@ros/web-core/app-links";

import { AddItemsDialog } from "./add-items-dialog";
import { GenerateBillDialog } from "./generate-bill-dialog";
import { useSessionDetail } from "./queries";
import { TABLE_STATUS_META } from "./table-status";

/** Staff orders saved on this device that the server has not confirmed yet. */
function UnsentOrders({ items }: { items: OutboxItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2" aria-label="Orders not sent yet">
      {items.map((i) => {
        const refused = i.status === "failed" || i.status === "conflict";
        return (
          <li
            key={i.id}
            className={
              refused
                ? "flex flex-col gap-1 rounded-xl border-2 border-destructive/60 bg-destructive/5 p-3 text-sm"
                : "flex flex-col gap-1 rounded-xl border-2 border-dashed border-warning bg-warning/10 p-3 text-sm"
            }
          >
            <p className="flex items-center gap-2 font-semibold">
              <CloudUpload className="size-4" aria-hidden />
              {refused ? "Not sent — needs attention" : "Not sent — will send when online"}
            </p>
            {i.meta?.summary && <p>{i.meta.summary}</p>}
            <p className="text-xs text-muted-foreground">
              {refused
                ? (i.lastError ?? "The server refused this order.") +
                  " Open the sync status to retry or discard it."
                : "Saved on this device. The kitchen gets it, with prices set by the server, once it is sent."}
            </p>
          </li>
        );
      })}
    </ul>
  );
}

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
  const links = useAppLinks();
  const sessionId = table?.session?.id ?? null;
  const detail = useSessionDetail(branchId, sessionId, pollInterval);
  const [adding, setAdding] = useState(false);
  const [billing, setBilling] = useState(false);
  const meta = table ? TABLE_STATUS_META[table.status] : null;
  const online = useSyncStore((s) => s.online);
  const outbox = useSyncStore((s) => s.items);
  const unsent = useMemo(
    () => (table ? queuedStaffOrders(outbox, table.tableId) : []),
    [outbox, table],
  );
  const bill = detail.data?.bill ?? table?.bill ?? null;
  const billable = table?.session?.billableSubtotal ?? 0;

  const canAdd = Boolean(table?.isActive) && can("orders.create");
  const canBill = Boolean(sessionId) && !bill && billable > 0 && can("bills.generate");
  // Nothing to bill and nothing in progress (e.g. a cancelled test order or only
  // rejected orders): the server lets the table close without a bill.
  const canCloseEmpty =
    Boolean(sessionId) &&
    !bill &&
    billable === 0 &&
    (table?.session?.activeCount ?? 0) === 0 &&
    can("sessions.manage");
  const qc = useQueryClient();
  const close = useCloseSession(branchId);
  const closeEmpty = () => {
    if (!sessionId) return;
    close.mutate(
      { sessionId },
      {
        onSuccess: () => {
          toast.success(`${table?.tableName ?? "Table"} is free again`);
          void qc.invalidateQueries({ queryKey: staffOpsKeys.branch(branchId) });
          onOpenChange(false);
        },
        onError: (e) => toast.error(closureReasons(e)[0] ?? errorMessage(e)),
      },
    );
  };

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
          <UnsentOrders items={unsent} />
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
                    <span className="text-sm text-muted-foreground tabular-nums">
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
        {table && (canAdd || canBill || bill || canCloseEmpty) && (
          <SheetFooter className="flex-row flex-wrap">
            {canAdd && (
              <Button className="flex-1" size="lg" onClick={() => setAdding(true)}>
                <Plus aria-hidden /> Add items
              </Button>
            )}
            {canBill && (
              <Button
                className="flex-1"
                size="lg"
                variant="outline"
                disabled={!online || unsent.length > 0}
                onClick={() => setBilling(true)}
              >
                <Receipt aria-hidden /> Generate bill
              </Button>
            )}
            {canBill && unsent.length > 0 && (
              // A bill now would silently leave these orders out.
              <p className="w-full text-xs text-muted-foreground">
                {unsent.length === 1
                  ? "1 order not sent yet — resolve it first."
                  : `${unsent.length} orders not sent yet — resolve them first.`}
              </p>
            )}
            {canBill && (
              <NeedsConnectionNote>Generating a bill needs a connection.</NeedsConnectionNote>
            )}
            {canCloseEmpty && (
              <Button
                className="flex-1"
                size="lg"
                variant="outline"
                disabled={!online || unsent.length > 0 || close.isPending}
                onClick={closeEmpty}
              >
                <DoorClosed aria-hidden /> Close table
              </Button>
            )}
            {bill && can("bills.view") && (
              <Button className="flex-1" size="lg" variant="outline" asChild>
                <Link href={appHref(links.console, `/app/b/${branchId}/bills`)}>
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
            sessionId={sessionId}
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
