"use client";

import { Timer, UserRound } from "lucide-react";

import { Card } from "@ros/ui/ui/card";
import type { OrderDto } from "@ros/contracts/orders";
import { formatMoney } from "@ros/domain/shared/money";
import { cn } from "@ros/ui/utils";
import { OrderActionButtons } from "@ros/web-core/features/orders/order-actions";
import {
  OrderItemsList,
  OrderStatusBadge,
  PriorityBadge,
  SpecialInstructions,
} from "@ros/web-core/features/orders/order-ui";
import { formatElapsed } from "@ros/web-core/features/orders/use-now";

/** A waiter-console ticket: table, age, items, notes and the next action. */
export function WaiterOrderCard({
  branchId,
  order,
  can,
  now,
  onOpen,
  highlight = false,
}: {
  branchId: string;
  order: OrderDto;
  can: (permission: string) => boolean;
  now: number;
  onOpen?: (orderId: string) => void;
  highlight?: boolean;
}) {
  const since =
    order.status === "READY"
      ? order.readyAt
      : order.status === "PENDING"
        ? order.createdAt
        : order.acceptedAt;
  const ageMinutes = since ? (now - new Date(since).getTime()) / 60_000 : 0;
  const waitingLong =
    order.status === "PENDING" ? ageMinutes >= 3 : order.status === "READY" && ageMinutes >= 5;

  return (
    <Card
      className={cn(
        "gap-3 p-4",
        highlight && "ring-2 ring-warning/70",
        waitingLong && "border-destructive/60",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          className="min-w-0 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
          onClick={() => onOpen?.(order.id)}
          aria-label={`Open order ${order.orderNumber} details`}
        >
          <p className="text-lg leading-tight font-semibold">
            {order.tableName}
            <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
              #{order.orderNumber}
            </span>
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            {order.source === "STAFF" ? (
              <>
                <UserRound className="size-3" aria-hidden /> Staff order
              </>
            ) : (
              "QR order"
            )}
            <span aria-hidden>·</span>
            {formatMoney(order.subtotal, order.currency)}
          </p>
        </button>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              "flex items-center gap-1 rounded-md px-2 py-0.5 text-sm font-semibold tabular-nums",
              waitingLong ? "bg-destructive/10 text-destructive" : "bg-muted",
            )}
            title="Time waiting"
          >
            <Timer className="size-3.5" aria-hidden />
            {formatElapsed(since, now)}
          </span>
          <div className="flex gap-1">
            <PriorityBadge priority={order.priority} />
            {order.status !== "PENDING" && <OrderStatusBadge status={order.status} />}
          </div>
        </div>
      </div>
      <OrderItemsList items={order.items} />
      <SpecialInstructions text={order.specialInstructions} />
      <OrderActionButtons
        branchId={branchId}
        order={order}
        can={can}
        only={["accept", "reject", "serve"]}
        size="lg"
        fill
      />
    </Card>
  );
}
