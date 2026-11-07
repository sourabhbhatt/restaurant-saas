"use client";

import { Clock, User } from "lucide-react";

import { ErrorState, LoadingState } from "@/components/shared/feedback";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { OrderDto } from "@ros/contracts/orders";
import {
  ORDER_PRIORITIES,
  TERMINAL_ORDER_STATUSES,
  type OrderPriority,
} from "@ros/domain/orders/order-status";
import { formatMoney } from "@ros/domain/shared/money";
import { errorMessage } from "@/lib/api-client";

import { OrderActionButtons } from "./order-actions";
import {
  OrderItemsList,
  OrderStatusBadge,
  OrderTimeline,
  PriorityBadge,
  SpecialInstructions,
} from "./order-ui";
import { useOrderDetail, useOrderPriority } from "./queries";
import { formatClock } from "./use-now";

export function PrioritySelect({
  branchId,
  order,
  disabled,
}: {
  branchId: string;
  order: OrderDto;
  disabled?: boolean;
}) {
  const mutation = useOrderPriority(branchId);
  return (
    <Select
      value={order.priority}
      disabled={disabled || mutation.isPending}
      onValueChange={(v) => mutation.mutate({ order, priority: v as OrderPriority })}
    >
      <SelectTrigger size="sm" aria-label="Priority" className="w-32">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ORDER_PRIORITIES.map((p) => (
          <SelectItem key={p} value={p}>
            {p.charAt(0) + p.slice(1).toLowerCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Stamp({ label, at, by }: { label: string; at: string | null; by?: string | null }) {
  if (!at) return null;
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">
        {formatClock(at)}
        {by ? <span className="text-muted-foreground"> · {by}</span> : null}
      </span>
    </div>
  );
}

/** Order detail: items, totals, timeline with staff attribution, and allowed actions. */
export function OrderDetailSheet({
  branchId,
  orderId,
  onOpenChange,
  can,
}: {
  branchId: string;
  orderId: string | null;
  onOpenChange: (open: boolean) => void;
  can: (permission: string) => boolean;
}) {
  const query = useOrderDetail(branchId, orderId);
  const order = query.data;
  const canPriority = can("orders.approve") || can("kitchen.update");

  return (
    <Sheet open={orderId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(100%-1rem,30rem)] sm:max-w-none">
        <SheetHeader>
          <SheetTitle>{order ? `Order #${order.orderNumber}` : "Order"}</SheetTitle>
          <SheetDescription>
            {order
              ? `${order.tableName} · ${order.source === "STAFF" ? "Staff order" : "QR order"}`
              : "Loading order"}
          </SheetDescription>
        </SheetHeader>
        <SheetBody className="flex flex-col gap-5">
          {query.isPending && <LoadingState label="Loading order…" />}
          {query.isError && (
            <ErrorState
              size="compact"
              message={errorMessage(query.error)}
              onRetry={() => void query.refetch()}
            />
          )}
          {order && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <OrderStatusBadge status={order.status} />
                <PriorityBadge priority={order.priority} />
                {canPriority &&
                  !TERMINAL_ORDER_STATUSES.includes(order.status) &&
                  order.status !== "SERVED" && (
                    <div className="ml-auto">
                      <PrioritySelect branchId={branchId} order={order} />
                    </div>
                  )}
              </div>
              {order.rejectionReason && (
                <p className="text-sm text-destructive">Rejected: {order.rejectionReason}</p>
              )}
              {order.cancellationReason && (
                <p className="text-sm text-destructive">Cancelled: {order.cancellationReason}</p>
              )}
              <SpecialInstructions text={order.specialInstructions} />
              <section aria-labelledby="order-items-h" className="flex flex-col gap-3">
                <h3 id="order-items-h" className="text-sm font-semibold">
                  Items ({order.itemCount})
                </h3>
                <OrderItemsList items={order.items} showItemStatus />
                <Separator />
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span>Subtotal</span>
                  <span className="tabular-nums">
                    {formatMoney(order.subtotal, order.currency)}
                  </span>
                </div>
              </section>
              <section aria-labelledby="order-times-h" className="flex flex-col gap-2">
                <h3 id="order-times-h" className="flex items-center gap-1.5 text-sm font-semibold">
                  <Clock className="size-4" aria-hidden /> Times
                </h3>
                <Stamp label="Placed" at={order.createdAt} />
                <Stamp label="Accepted" at={order.acceptedAt} by={order.acceptedByName} />
                <Stamp label="Preparing" at={order.preparingAt} />
                <Stamp label="Ready" at={order.readyAt} />
                <Stamp label="Served" at={order.servedAt} />
                <Stamp label="Completed" at={order.completedAt} />
              </section>
              <section aria-labelledby="order-timeline-h" className="flex flex-col gap-3">
                <h3
                  id="order-timeline-h"
                  className="flex items-center gap-1.5 text-sm font-semibold"
                >
                  <User className="size-4" aria-hidden /> History
                </h3>
                <OrderTimeline events={order.timeline ?? []} />
              </section>
            </>
          )}
        </SheetBody>
        {order && (
          <SheetFooter>
            <OrderActionButtons branchId={branchId} order={order} can={can} fill />
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  );
}
