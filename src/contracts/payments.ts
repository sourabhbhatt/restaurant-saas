import { z } from "zod";

import { BILLING_CYCLES, type BillingCycle } from "@/domain/subscriptions/entitlements";

export const PAYMENT_ORDER_STATUSES = ["CREATED", "PAID", "FAILED", "EXPIRED"] as const;
export type PaymentOrderStatus = (typeof PAYMENT_ORDER_STATUSES)[number];

/** The client names the plan and cycle only; the price always comes from the database. */
export const createCheckoutSchema = z.object({
  planKey: z.string().trim().min(1, "Choose a plan").max(40),
  billingCycle: z.enum(BILLING_CYCLES),
});
export type CreateCheckoutInput = z.input<typeof createCheckoutSchema>;

/** What Razorpay Checkout hands the page's `handler` callback. */
export const verifyCheckoutSchema = z.object({
  razorpayOrderId: z.string().trim().min(1).max(64),
  razorpayPaymentId: z.string().trim().min(1).max(64),
  razorpaySignature: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{64}$/, "Invalid signature"),
});
export type VerifyCheckoutInput = z.input<typeof verifyCheckoutSchema>;

/** Everything Checkout needs to open. Never carries a secret. */
export interface CheckoutSessionDto {
  provider: string;
  /** Publishable key id (RAZORPAY_KEY_ID). */
  keyId: string;
  orderId: string;
  paymentOrderId: string;
  amountMinor: number;
  currency: string;
  planKey: string;
  planName: string;
  billingCycle: BillingCycle;
  organizationName: string;
}

export interface PaymentOrderDto {
  id: string;
  provider: string;
  providerOrderId: string;
  planKey: string;
  billingCycle: BillingCycle;
  amountMinor: number;
  currency: string;
  status: PaymentOrderStatus;
  createdAt: string;
  paidAt: string | null;
}

/** `status` is ACTIVE only once the organization's subscription was activated for this order. */
export interface CheckoutVerifyDto {
  status: "ACTIVE" | "PENDING";
  order: PaymentOrderDto;
  currentPeriodEnd: string | null;
}

export interface WebhookResultDto {
  received: true;
  outcome: "activated" | "duplicate" | "ignored" | "already_paid" | "mismatch" | "unknown_order";
}
