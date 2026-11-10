"use client";

import { Check, ChefHat, CircleCheckBig, Clock, CloudUpload, Flame } from "lucide-react";
import { onlineManager, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@ros/ui/shared/feedback";
import { Button } from "@ros/ui/ui/button";
import type { OrderItemDto } from "@ros/contracts/orders";
import type { KitchenOrderDto } from "@ros/contracts/staff-ops";
import { isDelayed, minutesSince } from "@ros/domain/orders/order-status";
import { errorMessage } from "@ros/api-client";
import { cn } from "@ros/ui/utils";
import {
  enqueueMutation,
  kitchenItemStatusMutation,
  offlineStorageAvailable,
  sendWithoutStorage,
  kitchenTransitionMutation,
  queuedKitchenState,
  useSyncStore,
  withConfirmedKitchenChanges,
  type EnqueueInput,
  type KitchenAction,
} from "@ros/web-core/features/offline";
import { OrderStatusBadge, PriorityBadge } from "@ros/web-core/features/orders/order-ui";
import { formatClock, formatElapsed } from "@ros/web-core/features/orders/use-now";

/** Late if over the dish's prep time or the branch delay limit, whichever comes first. */
function delayThreshold(order: KitchenOrderDto, kitchenDelayMinutes: number): number {
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

function WaitingToSync({ className }: { className?: string }) {
  return (
    <StatusBadge tone="warning" className={className}>
      <CloudUpload aria-hidden /> Waiting to sync
    </StatusBadge>
  );
}

function ItemRow({
  item,
  queuedStatus,
  interactive,
  onToggle,
}: {
  item: OrderItemDto;
  /** Status a change saved on this device will set once it reaches the server. */
  queuedStatus?: "PREPARING" | "READY";
  interactive: boolean;
  onToggle: () => void;
}) {
  // A queued change is never shown as done: only the server's status counts.
  const done = !queuedStatus && (item.status === "READY" || item.status === "SERVED");
  const cooking = !queuedStatus && item.status === "PREPARING";
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
        {queuedStatus ? (
          <CloudUpload className="size-4 text-warning" />
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
        {queuedStatus && <WaitingToSync className="mt-1" />}
      </span>
    </>
  );
  if (!interactive || cancelled)
    return <li className="flex items-start gap-3 py-1.5">{content}</li>;
  const effective = queuedStatus ?? item.status;
  const next = NEXT_ITEM_STATUS[effective];
  const state = queuedStatus ? "waiting to sync" : item.status.toLowerCase();
  return (
    <li>
      <button
        type="button"
        disabled={!next}
        onClick={onToggle}
        aria-label={`${item.quantity} ${item.itemName}: ${state}. Tap to mark ${next?.toLowerCase()}`}
        className="flex min-h-12 w-full items-start gap-3 rounded-lg py-1.5 text-left outline-none hover:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {content}
      </button>
    </li>
  );
}

/**
 * One kitchen ticket. Large type, per-item toggles, Start / Mark ready.
 * Every change, online too, goes through the outbox: one FIFO per order, each
 * sent after the previous one resolved and on the version it returned, so
 * quick taps arrive in order and a stale tap is a 409 conflict instead of a
 * blind write. A change shows "Waiting to sync" until the server confirms it;
 * then the server's answer is shown until the feed catches up.
 */
const subscribeOnline = (notify: () => void) => onlineManager.subscribe(notify);
const isOnline = () => onlineManager.isOnline();
// Storage availability does not change while the page is open.
const subscribeNever = () => () => undefined;

/**
 * Whether taps can be saved now. With IndexedDB they wait until the offline
 * runtime knows who is signed in (a fresh page, /auth/me pending): "Connecting…".
 * Without it (private mode, storage blocked) a tap is sent directly while
 * online, one at a time; offline nothing can be saved in this browser.
 */
function useKitchenSaving() {
  const userId = useSyncStore((s) => s.userId);
  // The server render assumes storage; the browser answers once hydrated.
  const storage = useSyncExternalStore(subscribeNever, offlineStorageAvailable, () => true);
  const online = useSyncExternalStore(subscribeOnline, isOnline, () => true);
  const [sending, setSending] = useState(false);
  return {
    storage,
    sending,
    setSending,
    connecting: storage && !userId,
    unavailable: !storage && !online,
  };
}

export function TicketCard({
  branchId,
  order: feedOrder,
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
  const outbox = useSyncStore((s) => s.items);
  // What the server last confirmed (newer than the feed until it is refetched).
  const order = useMemo(() => withConfirmedKitchenChanges(outbox, feedOrder), [outbox, feedOrder]);
  const queued = useMemo(() => queuedKitchenState(outbox, order.id), [outbox, order.id]);
  const delayed = ticketIsDelayed(order, kitchenDelayMinutes, now);
  const elapsedMin = order.acceptedAt ? minutesSince(new Date(order.acceptedAt), new Date(now)) : 0;
  const active = order.status === "ACCEPTED" || order.status === "PREPARING";
  const readyQueued = queued.actions.includes("ready");
  const liveItems = order.items.filter((i) => i.status !== "CANCELLED");
  const allItemsQueuedReady =
    liveItems.length > 0 &&
    liveItems.every((i) => (queued.itemStatus[i.id] ?? i.status) === "READY") &&
    Object.keys(queued.itemStatus).length > 0;
  const startQueued =
    queued.actions.includes("start") || Object.values(queued.itemStatus).length > 0;

  const queryClient = useQueryClient();
  const saving = useKitchenSaving();
  const canTap = !saving.connecting && !saving.unavailable && !saving.sending;
  const queue = (input: EnqueueInput) => {
    if (!saving.storage) {
      // No IndexedDB: straight to the server; the ticket changes only once it answered.
      saving.setSending(true);
      sendWithoutStorage(input)
        .then(() =>
          Promise.all(
            (input.invalidateKeys ?? []).map((queryKey) =>
              queryClient.invalidateQueries({ queryKey }),
            ),
          ),
        )
        .catch((error: unknown) => toast.error(errorMessage(error)))
        .finally(() => saving.setSending(false));
      return;
    }
    enqueueMutation(input).catch((error: unknown) => toast.error(errorMessage(error)));
  };
  const runAction = (kind: KitchenAction) => {
    queue(kitchenTransitionMutation({ branchId, order, action: kind }));
  };

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
          <div className="flex flex-wrap justify-end gap-1">
            <PriorityBadge priority={order.priority} className="text-sm" />
            <OrderStatusBadge status={order.status} className="text-sm" />
            {queued.waiting && <WaitingToSync className="text-sm" />}
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
      {saving.unavailable && (
        <p className="rounded-lg bg-destructive/10 px-3 py-1 text-base font-semibold text-destructive">
          Changes can&apos;t be saved in this browser while offline (its storage is blocked).
          Reconnect to update tickets.
        </p>
      )}
      {queued.needsAttention && (
        <p className="rounded-lg bg-destructive/10 px-3 py-1 text-base font-semibold text-destructive">
          A change to this ticket was not saved. Open the sync status to retry or discard it.
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
            queuedStatus={queued.itemStatus[i.id]}
            interactive={canUpdate && active && !readyQueued && canTap}
            onToggle={() => {
              const next = NEXT_ITEM_STATUS[queued.itemStatus[i.id] ?? i.status];
              if (!next) return;
              queue(kitchenItemStatusMutation({ branchId, order, item: i, status: next }));
            }}
          />
        ))}
      </ul>
      {canUpdate && active && (
        <div className="mt-auto flex gap-2">
          {order.status === "ACCEPTED" && !startQueued && (
            <Button
              size="lg"
              className="h-14 flex-1 text-lg"
              disabled={!canTap}
              onClick={() => runAction("start")}
            >
              <ChefHat aria-hidden />
              Start preparing
            </Button>
          )}
          <Button
            size="lg"
            variant="success"
            className="h-14 flex-1 text-lg"
            disabled={readyQueued || allItemsQueuedReady || !canTap}
            onClick={() => runAction("ready")}
          >
            <CircleCheckBig aria-hidden />
            {saving.connecting ? "Connecting…" : "Mark ready"}
          </Button>
        </div>
      )}
      {order.status === "READY" && (
        <p className="mt-auto text-center text-lg font-semibold text-success">Waiting for pickup</p>
      )}
    </article>
  );
}
