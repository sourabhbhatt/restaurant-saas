import { z } from "zod";

import { DISCOUNT_TYPES } from "@/domain/billing/bill-calculator";
import {
  PAYMENT_METHODS,
  type BillStatus,
  type PaymentMethod,
  type PaymentStatus,
} from "@/domain/billing/payments";

/** Billing API contract (waiter bill generation, cashier, customer bill view). */

export const billDiscountSchema = z
  .object({
    type: z.enum(DISCOUNT_TYPES),
    /** PERCENT: basis points (1000 = 10%). FLAT: minor units. */
    value: z.number().int().min(0, "Discount cannot be negative"),
    reason: z.string().trim().max(200).nullish(),
  })
  .refine((d) => d.type !== "PERCENT" || d.value <= 10_000, {
    message: "Discount cannot exceed 100%",
    path: ["value"],
  });

export const generateBillSchema = z.object({
  sessionId: z.uuid(),
  discount: billDiscountSchema.nullable().optional(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
});

export const previewBillSchema = z.object({
  sessionId: z.uuid(),
  discount: billDiscountSchema.nullable().optional(),
});

export const recordPaymentSchema = z.object({
  method: z.enum(PAYMENT_METHODS),
  amount: z.number().int().positive("Enter an amount greater than zero"),
  /** Cash handed over, to compute change (CASH only). */
  tendered: z.number().int().positive().optional(),
  reference: z.string().trim().max(100).optional(),
  note: z.string().trim().max(200).optional(),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
});
export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;

export const refundSchema = recordPaymentSchema.omit({ tendered: true }).extend({
  note: z.string().trim().min(3, "Give a reason for the refund").max(200),
});

export const voidSchema = z.object({ reason: z.string().trim().min(3, "Give a reason").max(200) });

export interface BillItemDto {
  orderNumber: number | null;
  name: string;
  variantName: string | null;
  addonsSummary: string | null;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PaymentDto {
  id: string;
  kind: "PAYMENT" | "REFUND";
  method: PaymentMethod;
  amount: number;
  tendered: number | null;
  reference: string | null;
  note: string | null;
  status: "CONFIRMED" | "VOIDED";
  recordedByName: string | null;
  createdAt: string;
  voidReason: string | null;
}

export interface BillTotalsDto {
  subtotal: number;
  discountAmount: number;
  serviceChargeBps: number;
  serviceChargeAmount: number;
  taxes: { name: string; rateBps: number; amount: number }[];
  taxTotal: number;
  grandTotal: number;
  pricesIncludeTax: boolean;
}

export interface BillDto extends BillTotalsDto {
  id: string;
  branchId: string;
  tableId: string;
  tableName: string;
  sessionId: string;
  billNumber: number;
  status: BillStatus;
  paymentStatus: PaymentStatus;
  currency: string;
  discount: { type: string; value: number; reason: string | null } | null;
  amountPaid: number;
  amountRefunded: number;
  balanceDue: number;
  issuedAt: string;
  issuedByName: string | null;
  closedAt: string | null;
  version: number;
  items: BillItemDto[];
  payments: PaymentDto[];
}

/** Customer-visible bill summary (no staff names, no payment references). */
export interface GuestBillDto extends BillTotalsDto {
  billNumber: number;
  currency: string;
  paymentStatus: PaymentStatus;
  amountPaid: number;
  balanceDue: number;
  items: BillItemDto[];
}

export interface PaymentSummaryDto {
  from: string;
  to: string;
  currency: string;
  totalCollected: number;
  byMethod: Record<PaymentMethod, number>;
  refunds: number;
  outstanding: number;
  partiallyPaidBills: number;
  billsIssued: number;
}
