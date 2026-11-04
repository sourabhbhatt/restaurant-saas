import { DomainError } from "../shared/errors";
import type { Permission } from "../access/permissions";

/**
 * Order lifecycle. A customer order never reaches the kitchen directly: it is
 * PENDING until a waiter accepts it. Payment state lives on the bill, never on
 * the order.
 */
export const ORDER_STATUSES = [
  "PENDING",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "SERVED",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ACTIVE_ORDER_STATUSES: readonly OrderStatus[] = [
  "PENDING",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "SERVED",
];
export const KITCHEN_STATUSES: readonly OrderStatus[] = ["ACCEPTED", "PREPARING", "READY"];
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
];
/** Orders whose items are billable. */
export const BILLABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  "ACCEPTED",
  "PREPARING",
  "READY",
  "SERVED",
  "COMPLETED",
];

export const ORDER_PRIORITIES = ["NORMAL", "HIGH", "RUSH"] as const;
export type OrderPriority = (typeof ORDER_PRIORITIES)[number];

export type OrderAction = "accept" | "reject" | "start" | "ready" | "serve" | "complete" | "cancel";

interface TransitionRule {
  from: readonly OrderStatus[];
  to: OrderStatus;
  permission: Permission | null;
  requiresReason: boolean;
}

/**
 * The only allowed transitions. `permission: null` marks system-driven
 * transitions (e.g. completion when the bill is paid).
 */
export const ORDER_TRANSITIONS: Record<OrderAction, TransitionRule> = {
  accept: {
    from: ["PENDING"],
    to: "ACCEPTED",
    permission: "orders.approve",
    requiresReason: false,
  },
  reject: { from: ["PENDING"], to: "REJECTED", permission: "orders.approve", requiresReason: true },
  start: {
    from: ["ACCEPTED"],
    to: "PREPARING",
    permission: "kitchen.update",
    requiresReason: false,
  },
  ready: {
    from: ["ACCEPTED", "PREPARING"],
    to: "READY",
    permission: "kitchen.update",
    requiresReason: false,
  },
  serve: { from: ["READY"], to: "SERVED", permission: "orders.serve", requiresReason: false },
  complete: { from: ["SERVED"], to: "COMPLETED", permission: null, requiresReason: false },
  cancel: {
    from: ["ACCEPTED", "PREPARING", "READY"],
    to: "CANCELLED",
    permission: "orders.cancel",
    requiresReason: true,
  },
};

export function canTransition(from: OrderStatus, action: OrderAction): boolean {
  return ORDER_TRANSITIONS[action].from.includes(from);
}

/** Validate a transition and return the target status, or throw. */
export function nextOrderStatus(
  from: OrderStatus,
  action: OrderAction,
  reason?: string | null,
): OrderStatus {
  const rule = ORDER_TRANSITIONS[action];
  if (!rule.from.includes(from)) {
    throw new DomainError(
      "INVALID_STATE_TRANSITION",
      `Cannot ${action} an order that is ${from.toLowerCase()}`,
      { details: { from, action } },
    );
  }
  if (rule.requiresReason && !reason?.trim()) {
    throw new DomainError("VALIDATION_FAILED", "A reason is required", {
      fieldErrors: { reason: ["Please provide a reason"] },
    });
  }
  return rule.to;
}

export function isActiveOrder(status: OrderStatus): boolean {
  return ACTIVE_ORDER_STATUSES.includes(status);
}

/** Item-level kitchen status (optional per-item tracking). */
export const ORDER_ITEM_STATUSES = [
  "PENDING",
  "PREPARING",
  "READY",
  "SERVED",
  "CANCELLED",
] as const;
export type OrderItemStatus = (typeof ORDER_ITEM_STATUSES)[number];

const ITEM_FLOW: Record<OrderItemStatus, readonly OrderItemStatus[]> = {
  PENDING: ["PREPARING", "READY", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["SERVED", "PREPARING"],
  SERVED: [],
  CANCELLED: [],
};

export function canTransitionItem(from: OrderItemStatus, to: OrderItemStatus): boolean {
  return ITEM_FLOW[from].includes(to);
}

/** Minutes since a timestamp, used for "delayed" highlighting. */
export function minutesSince(from: Date, now: Date): number {
  return Math.floor((now.getTime() - from.getTime()) / 60_000);
}

export function isDelayed(
  acceptedAt: Date | null,
  expectedPrepMinutes: number,
  now: Date,
): boolean {
  if (!acceptedAt) return false;
  return minutesSince(acceptedAt, now) > Math.max(expectedPrepMinutes, 1);
}
