import type { OrderDto, OrderItemDto } from "@ros/contracts/orders";
import { staffOpsKeys } from "../orders/keys";

import type { OutboxItem } from "./db";
import type { EnqueueInput } from "./sync-engine";

/**
 * Outbox entries for staff operations that may be applied later: kitchen
 * item status, kitchen start/ready and staff-entered orders. Accepting or
 * rejecting orders, bills, payments, refunds, closing sessions and guest
 * ordering are never queued.
 */

export const KITCHEN_ITEM_STATUS = "kitchen.item-status";
export const KITCHEN_TRANSITION = "kitchen.transition";
export const STAFF_ORDER = "orders.staff-create";

export type KitchenItemTarget = "PREPARING" | "READY";
export type KitchenAction = "start" | "ready";

const orderScope = (orderId: string) => `order:${orderId}`;
const tableScope = (tableId: string) => `table:${tableId}`;

/** Unsynced items (waiting, in flight or needing the user's decision). */
const unsynced = (i: OutboxItem) => i.status !== "synced";
const waiting = (i: OutboxItem) => i.status === "pending" || i.status === "syncing";

export function kitchenItemStatusMutation(input: {
  branchId: string;
  order: Pick<OrderDto, "id" | "orderNumber" | "version">;
  item: Pick<OrderItemDto, "id" | "itemName" | "quantity">;
  status: KitchenItemTarget;
}): EnqueueInput {
  const { order, item, status } = input;
  return {
    kind: KITCHEN_ITEM_STATUS,
    label: `#${order.orderNumber} · ${item.quantity}× ${item.itemName}: mark ${status === "READY" ? "ready" : "cooking"}`,
    method: "PATCH",
    path: `/orders/${order.id}/items/${item.id}`,
    body: { status },
    scopeKey: orderScope(order.id),
    expectedVersion: order.version,
    versionField: "expectedVersion",
    chainVersion: true,
    meta: { orderId: order.id, itemId: item.id, status },
    invalidateKeys: [[...staffOpsKeys.branch(input.branchId)]],
  };
}

export function kitchenTransitionMutation(input: {
  branchId: string;
  order: Pick<OrderDto, "id" | "orderNumber" | "version">;
  action: KitchenAction;
}): EnqueueInput {
  const { order, action } = input;
  return {
    kind: KITCHEN_TRANSITION,
    label: `#${order.orderNumber} · ${action === "start" ? "start cooking" : "mark ready"}`,
    method: "POST",
    path: `/orders/${order.id}/transition`,
    body: { action },
    scopeKey: orderScope(order.id),
    expectedVersion: order.version,
    versionField: "expectedVersion",
    chainVersion: true,
    meta: { orderId: order.id, action },
    invalidateKeys: [[...staffOpsKeys.branch(input.branchId)]],
  };
}

export interface StaffOrderDraft {
  tableId: string;
  priority: "NORMAL" | "HIGH" | "RUSH";
  specialInstructions?: string;
  /** Generated once per draft; the server creates at most one order per key. */
  idempotencyKey: string;
  /**
   * The table's open session when the order was composed (null: the table was
   * free). The server refuses the order with 409 SESSION_CHANGED when the
   * table's session differs by the time the order arrives.
   */
  expectedSessionId: string | null;
  lines: {
    menuItemId: string;
    variantId?: string | null;
    addonIds: string[];
    quantity: number;
    notes?: string;
  }[];
}

export function staffOrderMutation(input: {
  branchId: string;
  tableName: string;
  body: StaffOrderDraft;
  /** e.g. "2× Masala Chai, 1× Butter Naan" (shown while unsent; never priced locally). */
  summary?: string;
}): EnqueueInput {
  const { body } = input;
  const count = body.lines.reduce((n, l) => n + l.quantity, 0);
  return {
    kind: STAFF_ORDER,
    label: `New order for ${input.tableName} (${count} item${count === 1 ? "" : "s"})`,
    method: "POST",
    path: `/branches/${input.branchId}/orders`,
    body,
    scopeKey: tableScope(body.tableId),
    idempotencyKey: body.idempotencyKey,
    meta: {
      tableId: body.tableId,
      tableName: input.tableName,
      ...(input.summary ? { summary: input.summary } : {}),
    },
    invalidateKeys: [[...staffOpsKeys.branch(input.branchId)]],
  };
}

export interface QueuedKitchenState {
  /** Item id → the status the last queued change will set. */
  itemStatus: Record<string, KitchenItemTarget>;
  /** Order transitions waiting to be sent. */
  actions: KitchenAction[];
  /** Something for this order has not reached the server yet. */
  waiting: boolean;
  /** A queued change was refused (conflict/failed) and waits for the user. */
  needsAttention: boolean;
}

/** What the outbox still holds for one kitchen ticket. */
export function queuedKitchenState(
  items: readonly OutboxItem[],
  orderId: string,
): QueuedKitchenState {
  const scope = orderScope(orderId);
  const mine = items
    .filter((i) => i.scopeKey === scope && unsynced(i))
    .sort((a, b) => a.createdAt - b.createdAt);
  const itemStatus: Record<string, KitchenItemTarget> = {};
  const actions: KitchenAction[] = [];
  for (const i of mine.filter(waiting)) {
    if (i.kind === KITCHEN_ITEM_STATUS && i.meta?.itemId && i.meta.status) {
      itemStatus[i.meta.itemId] = i.meta.status as KitchenItemTarget;
    } else if (i.kind === KITCHEN_TRANSITION && i.meta?.action) {
      actions.push(i.meta.action as KitchenAction);
    }
  }
  return {
    itemStatus,
    actions,
    waiting: mine.some(waiting),
    needsAttention: mine.some((i) => i.status === "failed" || i.status === "conflict"),
  };
}

type KitchenOrderLike = {
  id: string;
  version: number;
  status: string;
  items: { id: string; status: string }[];
};

/**
 * The ticket as the server last confirmed it. Between a queued kitchen change
 * reaching the server and the kitchen feed being refetched, the feed still
 * holds the previous state and version; taps made in that window would build
 * on stale data (a second tap could resend the first step, or toggle a ready
 * line back). So the newest order the server returned for this order's synced
 * changes wins while it is newer than the feed: its version, status and line
 * statuses. Only server answers are used, never a queued intent.
 */
export function withConfirmedKitchenChanges<T extends KitchenOrderLike>(
  items: readonly OutboxItem[],
  order: T,
): T {
  const scope = orderScope(order.id);
  let latest: KitchenOrderLike | null = null;
  for (const i of items) {
    if (i.scopeKey !== scope || i.status !== "synced") continue;
    if (i.kind !== KITCHEN_ITEM_STATUS && i.kind !== KITCHEN_TRANSITION) continue;
    const res = i.serverResponse as Partial<KitchenOrderLike> | undefined;
    if (!res || res.id !== order.id || typeof res.version !== "number") continue;
    if (!latest || res.version > latest.version) latest = res as KitchenOrderLike;
  }
  if (!latest || latest.version <= order.version) return order;
  const confirmed = latest;
  const statusOf = new Map((confirmed.items ?? []).map((line) => [line.id, line.status]));
  return {
    ...order,
    version: confirmed.version,
    status: typeof confirmed.status === "string" ? confirmed.status : order.status,
    items: order.items.map((line) => {
      const status = statusOf.get(line.id);
      return status ? { ...line, status } : line;
    }),
  };
}

/** A queued staff order older than this is not sent without the user's confirmation. */
export const STAFF_ORDER_MAX_AGE_MS = 10 * 60_000;
/** `lastErrorCode` of an item held until the user confirms sending it. */
export const NEEDS_CONFIRMATION = "NEEDS_CONFIRMATION";

export type HoldReason = "too-old" | "signed-out";

/**
 * Whether a pending staff order must wait for an explicit "Send now?" instead
 * of being sent automatically: it was composed more than 10 minutes ago, or
 * someone signed out on this device after it was queued (the table has likely
 * moved on). Items the user already confirmed are never held again.
 */
export function staffOrderHoldReason(
  item: OutboxItem,
  context: { now: number; signedOutAt: number | null },
): HoldReason | null {
  if (item.kind !== STAFF_ORDER || item.status !== "pending" || item.confirmedAt) return null;
  if (context.signedOutAt !== null && item.createdAt < context.signedOutAt) return "signed-out";
  if (context.now - item.createdAt > STAFF_ORDER_MAX_AGE_MS) return "too-old";
  return null;
}

/** The question shown for a held staff order. */
export function sendConfirmationPrompt(item: OutboxItem, now: number): string {
  const minutes = Math.max(1, Math.round((now - item.createdAt) / 60_000));
  const ago = `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  return item.meta?.holdReason === "signed-out"
    ? `This order was composed ${ago}, before a sign-out on this device. Send it now?`
    : `This order was composed ${ago}. Send it now?`;
}

/** True while an item waits for the user to confirm (Send now) or discard it. */
export const needsSendConfirmation = (item: OutboxItem) =>
  item.status === "conflict" && item.lastErrorCode === NEEDS_CONFIRMATION;

/** Staff orders for a table that have not been confirmed by the server yet. */
export function queuedStaffOrders(items: readonly OutboxItem[], tableId: string): OutboxItem[] {
  const scope = tableScope(tableId);
  return items
    .filter((i) => i.kind === STAFF_ORDER && i.scopeKey === scope && unsynced(i))
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** True when changes for this scope must go through the outbox to keep their order. */
export function scopeHasUnsynced(items: readonly OutboxItem[], scopeKey: string): boolean {
  return items.some((i) => i.scopeKey === scopeKey && unsynced(i));
}

export { orderScope, tableScope };
