"use client";

import { Check, ChefHat, CircleCheckBig, Clock, Flame } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { OrderItemDto } from "@/contracts/orders";
import type { KitchenOrderDto } from "@/contracts/staff-ops";
import { isDelayed, minutesSince } from "@/domain/orders/order-status";
import { cn } from "@/lib/utils";
import { OrderStatusBadge, PriorityBadge } from "@/features/orders/order-ui";
import { useItemStatus, useOrderAction } from "@/features/orders/queries";
import { formatClock, formatElapsed } from "@/features/orders/use-now";

/** Late if over the dish's prep time or the branch delay limit, whichever comes first. */
export function delayThreshold(order: KitchenOrderDto, kitchenDelayMinutes: number): number {
  return Math.min(order.expectedPrepMinutes, kitchenDelayMinutes);
}

export function ticketIsDelayed(order: KitchenOrderDto, kitchenDelayMinutes: number, now: number) {
  if (order.status !== "ACCEPTED" && order.status !== "PREPARING") return false;
  return isDelayed(
    order.acceptedAt ? new Date(order.acceptedAt) : null,
    delayThreshold(order, kitchenDelayMinutes),
    new Date(now),
  );
}

const NEXT_ITEM_STATUS: Partial<Record<OrderItemDto["status"], "PREPARING" | "READY">> = {
  PENDING: "PREPARING",
  PREPARING: "READY",
  READY: "PREPARING",
};

function ItemRow({
  item,
  interactive,
  pending,
  onToggle,
}: {
  item: OrderItemDto;
  interactive: boolean;
  pending: boolean;
  onToggle: () => void;
}) {
  const done = item.status === "READY" || item.status === "SERVED";
  const cooking = item.status === "PREPARING";
  const cancelled = item.status === "CANCELLED";
  const content = (
    <>
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md border-2 text-lg font-bold tabular-nums",
          done && "border-success bg-success text-success-foreground",
          cooking && "border-info text-info",
        )}
        aria-hidden
      >
        {pending ? (
          <Spinner decorative />
        ) : done ? (
          <Check className="size-5" />
        ) : cooking ? (
          <Flame className="size-4" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-xl leading-snug font-semibold",
            (done || cancelled) && "text-muted-foreground line-through",
          )}
        >
          <span className="mr-2 tabular-nums">{item.quantity}×</span>
          {item.itemName}
          {item.variantName && (
            <span className="font-medium text-muted-foreground"> · {item.variantName}</span>
          )}
        </span>
        {item.addons.length > 0 && (
          <span className="block text-base text-muted-foreground">
            + {item.addons.map((a) => a.name).join(", ")}
          </span>
        )}
        {item.notes && (
          <span className="mt-0.5 block rounded bg-warning/20 px-1.5 text-base font-semibold text-warning-foreground dark:text-warning">
            {item.notes}
          </span>
        )}
      </span>
    </>
  );
  if (!interactive || cancelled)
    return <li className="flex items-start gap-3 py-1.5">{content}</li>;
  const next = NEXT_ITEM_STATUS[item.status];
  return (
    <li>
      <button
        type="button"
        disabled={pending || !next}
        onClick={onToggle}
        aria-label={`${item.quantity} ${item.itemName}: ${item.status.toLowerCase()}. Tap to mark ${next?.toLowerCase()}`}
        className="flex min-h-12 w-full items-start gap-3 rounded-lg py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {content}
      </button>
    </li>
  );
}

/** One kitchen ticket. Large type, per-item toggles, Start / Mark ready. */
export function TicketCard({
  branchId,
  order,
  now,
  kitchenDelayMinutes,
  canUpdate,
  fresh,
}: {
  branchId: string;
  order: KitchenOrderDto;
  now: number;
  kitchenDelayMinutes: number;
  canUpdate: boolean;
  fresh: boolean;
}) {
  const action = useOrderAction(branchId);
  const item = useItemStatus(branchId);
  const delayed = ticketIsDelayed(order, kitchenDelayMinutes, now);
  const elapsedMin = order.acceptedAt ? minutesSince(new Date(order.acceptedAt), new Date(now)) : 0;
  const active = order.status === "ACCEPTED" || order.status === "PREPARING";
  const busy = action.isPending || item.isPending;

  return (
    <article
      aria-label={`Order ${order.orderNumber}, ${order.tableName}${delayed ? ", delayed" : ""}`}
      className={cn(
        "relative flex flex-col gap-3 rounded-2xl border-2 bg-card p-4 text-card-foreground shadow-sm",
        order.status === "READY" && "border-success",
        order.priority === "RUSH" && active && "border-destructive/70",
        delayed &&
          "border-destructive bg-destructive/5 before:pointer-events-none before:absolute before:-inset-1 before:rounded-[1.2rem] before:border-4 before:border-destructive motion-safe:before:animate-pulse",
        fresh && !delayed && "ring-4 ring-info/50",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-3xl leading-none font-bold tabular-nums">#{order.orderNumber}</p>
          <p className="mt-1 truncate text-xl font-semibold">{order.tableName}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className={cn(
              "flex items-center gap-1 rounded-lg px-2 py-1 text-xl font-bold tabular-nums",
              delayed ? "bg-destructive text-destructive-foreground" : "bg-muted",
            )}
            title={`Expected about ${order.expectedPrepMinutes} min`}
          >
            <Clock className="size-5" aria-hidden />
            {formatElapsed(order.status === "READY" ? order.readyAt : order.acceptedAt, now)}
          </span>
          <span className="text-sm text-muted-foreground">
            In {formatClock(order.acceptedAt)} · ~{order.expectedPrepMinutes}m
          </span>
          <div className="flex gap-1">
            <PriorityBadge priority={order.priority} className="text-sm" />
            <OrderStatusBadge status={order.status} className="text-sm" />
          </div>
        </div>
      </header>
      {delayed && (
        <p
          className="rounded-lg bg-destructive px-3 py-1 text-base font-bold text-destructive-foreground"
          role="status"
        >
          Delayed · {elapsedMin} min
        </p>
      )}
      {order.specialInstructions && (
        <p className="rounded-lg border-2 border-warning bg-warning/20 px-3 py-2 text-lg font-semibold text-warning-foreground dark:text-warning">
          {order.specialInstructions}
        </p>
      )}
      <ul className="flex flex-col divide-y">
        {order.items.map((i) => (
          <ItemRow
            key={i.id}
            item={i}
            interactive={canUpdate && active}
            pending={item.isPending && item.variables?.itemId === i.id}
            onToggle={() => {
              const next = NEXT_ITEM_STATUS[i.status];
              if (next) item.mutate({ orderId: order.id, itemId: i.id, status: next });
            }}
          />
        ))}
      </ul>
      {canUpdate && active && (
        <div className="mt-auto flex gap-2">
          {order.status === "ACCEPTED" && (
            <Button
              size="lg"
              className="h-14 flex-1 text-lg"
              disabled={busy}
              onClick={() => action.mutate({ order, action: "start" })}
            >
              {action.isPending && action.variables?.action === "start" ? (
                <Spinner decorative />
              ) : (
                <ChefHat aria-hidden />
              )}
              Start
            </Button>
          )}
          <Button
            size="lg"
            variant="success"
            className="h-14 flex-1 text-lg"
            disabled={busy}
            onClick={() => action.mutate({ order, action: "ready" })}
          >
            {action.isPending && action.variables?.action === "ready" ? (
              <Spinner decorative />
            ) : (
              <CircleCheckBig aria-hidden />
            )}
            Mark ready
          </Button>
        </div>
      )}
      {order.status === "READY" && (
        <p className="mt-auto text-center text-lg font-semibold text-success">Waiting for pickup</p>
      )}
    </article>
  );
}
