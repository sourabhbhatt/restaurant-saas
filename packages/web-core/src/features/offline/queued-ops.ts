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
