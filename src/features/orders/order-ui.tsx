"use client";

import { Flame, MessageSquareText, Zap } from "lucide-react";

import { StatusBadge, type StatusTone } from "@/components/shared/feedback";
import type { OrderItemDto, OrderStatusEventDto } from "@/contracts/orders";
import type { OrderItemStatus, OrderPriority, OrderStatus } from "@/domain/orders/order-status";
import { cn } from "@/lib/utils";

import { formatClock } from "./use-now";

export const ORDER_STATUS_META: Record<OrderStatus, { label: string; tone: StatusTone }> = {
  PENDING: { label: "Pending", tone: "warning" },
  ACCEPTED: { label: "Accepted", tone: "info" },
  PREPARING: { label: "Preparing", tone: "info" },
  READY: { label: "Ready", tone: "success" },
  SERVED: { label: "Served", tone: "neutral" },
  COMPLETED: { label: "Completed", tone: "neutral" },
  REJECTED: { label: "Rejected", tone: "danger" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
};

const ITEM_STATUS_META: Record<OrderItemStatus, { label: string; tone: StatusTone }> = {
  PENDING: { label: "Queued", tone: "neutral" },
  PREPARING: { label: "Cooking", tone: "info" },
  READY: { label: "Ready", tone: "success" },
  SERVED: { label: "Served", tone: "neutral" },
  CANCELLED: { label: "Cancelled", tone: "danger" },
};

export function OrderStatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const meta = ORDER_STATUS_META[status];
  return (
    <StatusBadge
      tone={meta.tone}
      dot
      pulse={status === "PREPARING" || status === "PENDING"}
      className={className}
    >
      {meta.label}
    </StatusBadge>
  );
}

export function PriorityBadge({ priority, className }: { priority: OrderPriority; className?: string }) {
  if (priority === "NORMAL") return null;
  return (
    <StatusBadge tone={priority === "RUSH" ? "danger" : "warning"} className={className}>
      {priority === "RUSH" ? <Zap aria-hidden /> : <Flame aria-hidden />}
      {priority === "RUSH" ? "Rush" : "High"}
    </StatusBadge>
  );
}

export function ItemStatusBadge({ status }: { status: OrderItemStatus }) {
  const meta = ITEM_STATUS_META[status];
  return <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>;
}

/** Item lines with variant, add-ons and notes. */
export function OrderItemsList({
  items,
  size = "default",
  showItemStatus = false,
  className,
}: {
  items: OrderItemDto[];
  size?: "default" | "lg";
  showItemStatus?: boolean;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {items.map((item) => (
        <li
          key={item.id}
          className={cn(
            "flex items-start gap-3",
            item.status === "CANCELLED" && "text-muted-foreground line-through",
          )}
        >
          <span
            className={cn(
              "min-w-8 shrink-0 rounded-md bg-muted text-center font-semibold tabular-nums",
              size === "lg" ? "px-2 py-1 text-lg" : "px-1.5 py-0.5 text-sm",
            )}
          >
            {item.quantity}×
          </span>
          <div className="min-w-0 flex-1">
            <p className={cn("leading-snug font-medium", size === "lg" ? "text-lg" : "text-sm")}>
              {item.itemName}
              {item.variantName && (
                <span className="font-normal text-muted-foreground"> · {item.variantName}</span>
              )}
            </p>
            {item.addons.length > 0 && (
              <p className={cn("text-muted-foreground", size === "lg" ? "text-base" : "text-xs")}>
                + {item.addons.map((a) => a.name).join(", ")}
              </p>
            )}
            {item.notes && (
              <p
                className={cn(
                  "mt-0.5 flex items-center gap-1 font-medium text-warning-foreground dark:text-warning",
                  size === "lg" ? "text-base" : "text-xs",
                )}
              >
                <MessageSquareText className="size-3.5 shrink-0" aria-hidden />
                {item.notes}
              </p>
            )}
          </div>
          {showItemStatus && <ItemStatusBadge status={item.status} />}
        </li>
      ))}
    </ul>
  );
}

export function SpecialInstructions({ text, size = "default" }: { text: string | null; size?: "default" | "lg" }) {
  if (!text) return null;
  return (
    <div
      className={cn(
        "rounded-lg border border-warning/50 bg-warning/15 px-3 py-2 font-medium text-warning-foreground dark:text-warning",
        size === "lg" ? "text-base" : "text-sm",
      )}
    >
      <span className="mr-1 font-semibold">Note:</span>
      {text}
    </div>
  );
}

/** Status history with staff attribution. */
export function OrderTimeline({ events }: { events: OrderStatusEventDto[] }) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No history recorded yet.</p>;
  }
  return (
    <ol className="relative flex flex-col gap-4 border-l pl-5">
      {events.map((e, i) => (
        <li key={`${e.at}-${i}`} className="relative">
          <span
            aria-hidden
            className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-background bg-primary"
          />
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={e.toStatus} />
            <time className="text-xs text-muted-foreground" dateTime={e.at}>
              {formatClock(e.at)}
            </time>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {e.actorName ??
              (e.actorType === "GUEST" ? "Guest" : e.actorType === "SYSTEM" ? "System" : "Staff")}
            {e.reason ? ` — “${e.reason}”` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}
