import { z } from "zod";

import {
  ORDER_PRIORITIES,
  type OrderItemStatus,
  type OrderPriority,
  type OrderStatus,
} from "@/domain/orders/order-status";

/**
 * Order API contract shared by the customer app, waiter, kitchen, billing and
 * analytics. Prices in requests are never trusted: the server reprices every
 * line from the menu at submission time and snapshots the result.
 */

export const orderLineInputSchema = z.object({
  menuItemId: z.uuid(),
  variantId: z.uuid().nullable().optional(),
  addonIds: z.array(z.uuid()).max(30).default([]),
  quantity: z
    .number()
    .int()
    .min(1, "Quantity must be at least 1")
    .max(99, "Quantity cannot exceed 99"),
  notes: z.string().trim().max(200, "Keep notes under 200 characters").optional(),
});
export type OrderLineInput = z.input<typeof orderLineInputSchema>;

export const placeOrderSchema = z.object({
  lines: z
    .array(orderLineInputSchema)
    .min(1, "Add at least one item")
    .max(50, "Too many items in one order"),
  specialInstructions: z
    .string()
    .trim()
    .max(500, "Keep instructions under 500 characters")
    .optional(),
  /** Client-generated, stable across retries of the same submission. */
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/, "Invalid idempotency key"),
});
export type PlaceOrderInput = z.input<typeof placeOrderSchema>;

/** Staff adding items to an active table session (waiter). */
export const staffPlaceOrderSchema = placeOrderSchema.extend({
  tableId: z.uuid(),
  priority: z.enum(ORDER_PRIORITIES).default("NORMAL"),
});

export const orderTransitionSchema = z.object({
  action: z.enum(["accept", "reject", "start", "ready", "serve", "cancel"]),
  reason: z.string().trim().max(300).optional(),
  /** Optimistic concurrency: the version the actor saw. */
  expectedVersion: z.number().int().positive(),
});
export type OrderTransitionInput = z.input<typeof orderTransitionSchema>;

export const orderPrioritySchema = z.object({
  priority: z.enum(ORDER_PRIORITIES),
  expectedVersion: z.number().int().positive(),
});

export const orderItemStatusSchema = z.object({
  status: z.enum(["PREPARING", "READY"]),
});

export interface OrderItemAddonDto {
  groupName: string;
  name: string;
  price: number;
}

export interface OrderItemDto {
  id: string;
  menuItemId: string | null;
  itemName: string;
  variantName: string | null;
  dietary: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  notes: string | null;
  status: OrderItemStatus;
  addons: OrderItemAddonDto[];
}

export interface OrderStatusEventDto {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actorType: "USER" | "GUEST" | "SYSTEM";
  actorName: string | null;
  reason: string | null;
  at: string;
}

export interface OrderDto {
  id: string;
  branchId: string;
  tableId: string;
  tableName: string;
  sessionId: string;
  orderNumber: number;
  source: "CUSTOMER" | "STAFF";
  status: OrderStatus;
  priority: OrderPriority;
  specialInstructions: string | null;
  currency: string;
  subtotal: number;
  itemCount: number;
  rejectionReason: string | null;
  cancellationReason: string | null;
  acceptedByName: string | null;
  createdAt: string;
  acceptedAt: string | null;
  preparingAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  completedAt: string | null;
  version: number;
  items: OrderItemDto[];
  /** Present on detail endpoints. */
  timeline?: OrderStatusEventDto[];
}

/** What a guest sees about their own order (no staff names or internal fields). */
export interface GuestOrderDto {
  id: string;
  orderNumber: number;
  status: OrderStatus;
  currency: string;
  subtotal: number;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  items: Pick<
    OrderItemDto,
    "itemName" | "variantName" | "quantity" | "lineTotal" | "notes" | "addons"
  >[];
}

export const orderListQuerySchema = z.object({
  status: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? undefined : Array.isArray(v) ? v : v.split(","))),
  sessionId: z.uuid().optional(),
  tableId: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
