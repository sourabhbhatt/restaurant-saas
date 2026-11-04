import { z } from "zod";

import type { PaymentStatus } from "@/domain/billing/payments";
import { ORDER_STATUSES, type OrderStatus } from "@/domain/orders/order-status";
import type { SessionStatus, TableStatus } from "@/domain/tables/table-status";

import { orderListQuerySchema, type OrderDto } from "./orders";

/**
 * Staff operations API contract (waiter console, kitchen display, branch
 * orders page, table sessions). Order shapes come from ./orders.
 */

const statusList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) =>
    v === undefined
      ? undefined
      : (Array.isArray(v) ? v : v.split(",")).map((s) => s.trim()).filter(Boolean),
  )
  .pipe(z.array(z.enum(ORDER_STATUSES, { message: "Unknown order status" })).optional());

/** GET /branches/:branchId/orders — orderListQuerySchema plus order-number search. */
export const staffOrderListQuerySchema = orderListQuerySchema.extend({
  status: statusList,
  orderNumber: z.coerce.number().int().positive().optional(),
});
export type StaffOrderListQuery = z.output<typeof staffOrderListQuerySchema>;

export const PRESET_REJECTION_REASONS = [
  "Item unavailable",
  "Kitchen closing",
  "Duplicate order",
  "Table not occupied",
  "Customer request",
] as const;

/** A kitchen ticket: an order plus the expected preparation time computed on the server. */
export interface KitchenOrderDto extends OrderDto {
  /** Max prep time (minutes) of the order's menu items; falls back to the branch delay. */
  expectedPrepMinutes: number;
}

export interface KitchenFeedDto {
  /** ACCEPTED / PREPARING / READY tickets, oldest first. */
  active: KitchenOrderDto[];
  /** Served, completed or cancelled-after-acceptance in the last 2 hours, newest first. */
  recent: KitchenOrderDto[];
  kitchenDelayMinutes: number;
  kitchenSoundEnabled: boolean;
  serverTime: string;
}

/** Bill summary for a session with a live (non-void) bill. */
export interface SessionBillSummaryDto {
  billId: string;
  billNumber: number;
  status: "ISSUED" | "CLOSED" | "VOID";
  paymentStatus: PaymentStatus;
  currency: string;
  grandTotal: number;
  balanceDue: number;
}

export interface TableSessionSummaryDto {
  id: string;
  status: SessionStatus;
  openedAt: string;
  billRequestedAt: string | null;
  orderCounts: Partial<Record<OrderStatus, number>>;
  /** Orders awaiting approval. */
  pendingCount: number;
  /** Orders that are not terminal (PENDING..SERVED). */
  activeCount: number;
  /** Sum of billable order subtotals (minor units). */
  billableSubtotal: number;
}

export interface BranchTableDto {
  tableId: string;
  tableName: string;
  section: string | null;
  capacity: number;
  isActive: boolean;
  status: TableStatus;
  session: TableSessionSummaryDto | null;
  bill: SessionBillSummaryDto | null;
}

export interface BranchSessionsDto {
  currency: string;
  waiterSoundEnabled: boolean;
  tables: BranchTableDto[];
}

export interface SessionDetailDto {
  table: { id: string; name: string; section: string | null; capacity: number };
  session: TableSessionSummaryDto;
  status: TableStatus;
  orders: OrderDto[];
  bill: SessionBillSummaryDto | null;
}
