import { z } from "zod";

import {
  BILL_STATUSES,
  PAYMENT_STATUSES,
  type BillStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@/domain/billing/payments";

import type {
  BillDto,
  BillItemDto,
  BillTotalsDto,
  PaymentDto,
} from "./billing";

/**
 * Billing contract additions (list, queue, preview, receipt and close-session
 * shapes). The core bill/payment contract lives in ./billing.ts.
 */

/** Calendar date in the branch timezone, e.g. "2026-11-04". */
export const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Invalid date");

const csvEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) =>
      v === undefined ? undefined : (Array.isArray(v) ? v : v.split(",")).filter(Boolean),
    )
    .pipe(z.array(z.enum(values)).optional());

export const billListQuerySchema = z.object({
  paymentStatus: csvEnum(PAYMENT_STATUSES),
  status: csvEnum(BILL_STATUSES),
  /** Inclusive local dates (branch timezone) on the issue time. */
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type BillListQuery = z.infer<typeof billListQuerySchema>;

export const paymentSummaryQuerySchema = z.object({
  /** Inclusive local dates in the branch timezone. Default: today. */
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
});

export interface BillListItemDto {
  id: string;
  billNumber: number;
  tableId: string;
  tableName: string;
  sessionId: string;
  status: BillStatus;
  paymentStatus: PaymentStatus;
  currency: string;
  grandTotal: number;
  amountPaid: number;
  amountRefunded: number;
  balanceDue: number;
  issuedAt: string;
  issuedByName: string | null;
  closedAt: string | null;
}

export interface BillListResponse {
  items: BillListItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** POST /branches/:branchId/bills/preview — totals computed from order snapshots, not saved. */
export interface BillPreviewDto extends BillTotalsDto {
  sessionId: string;
  tableName: string;
  currency: string;
  items: BillItemDto[];
  billableOrderCount: number;
  pendingOrderCount: number;
  /** Human-readable notes such as "2 orders still pending approval". */
  warnings: string[];
  /** Live bill already issued for this session (generate would be refused). */
  existingBillId: string | null;
}

/** A table session that has orders but no live bill yet (cashier queue). */
export interface SessionAwaitingBillDto {
  sessionId: string;
  tableId: string;
  tableName: string;
  status: "OPEN" | "BILL_REQUESTED" | "BILLED";
  openedAt: string;
  billRequestedAt: string | null;
  billableOrderCount: number;
  pendingOrderCount: number;
  /** Sum of billable order lines (before discount, service charge and tax). */
  runningSubtotal: number;
}

/** GET /branches/:branchId/bills/queue */
export interface CashierQueueDto {
  currency: string;
  timezone: string;
  config: BillingConfigDto;
  sessions: SessionAwaitingBillDto[];
  /** Live bills that are not closed yet (unpaid, partially paid or paid awaiting closure). */
  openBills: BillListItemDto[];
}

/** POST /bills/:billId/payments and /bills/:billId/refunds */
export interface PaymentResultDto {
  payment: PaymentDto;
  bill: BillDto;
  /** Change to hand back for a cash tender, otherwise null. */
  change: number | null;
  /** True when this response replays an earlier request with the same idempotency key. */
  replayed: boolean;
}

/** GET /bills/:billId/receipt — the bill plus what a printed receipt needs. */
export interface ReceiptDto {
  bill: BillDto;
  restaurantName: string;
  branchName: string;
  legalName: string | null;
  taxId: string | null;
  addressLines: string[];
  phone: string | null;
  timezone: string;
  receiptHeader: string | null;
  receiptFooter: string | null;
}

/** POST /branches/:branchId/sessions/:sessionId/close */
export interface SessionCloseResultDto {
  sessionId: string;
  status: "CLOSED";
  closedAt: string;
  billId: string | null;
  completedOrders: number;
}

/** Branch billing configuration the cashier UI needs (from branch settings). */
export interface BillingConfigDto {
  paymentMethods: PaymentMethod[];
  requireFullPaymentToClose: boolean;
  serviceChargeBps: number;
  pricesIncludeTax: boolean;
}
