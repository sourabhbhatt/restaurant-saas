import { sql } from "drizzle-orm";
import { check, index, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { BillingCycle } from "@ros/domain/subscriptions/entitlements";

import { id, money, timestamps, tstz } from "./_helpers";
import { users } from "./identity";
import { subscriptionPlans } from "./platform";
import { organizations } from "./tenancy";

export const PAYMENT_ORDER_STATUSES = ["CREATED", "PAID", "FAILED", "EXPIRED"] as const;
export type PaymentOrderStatus = (typeof PAYMENT_ORDER_STATUSES)[number];

/**
 * One prepaid billing period bought through the payment gateway. The amount
 * is copied from the plan at checkout so a later price change cannot alter
 * what the provider must confirm. Activated exactly once (status PAID).
 */
export const paymentOrders = pgTable(
  "payment_orders",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerOrderId: text("provider_order_id").notNull(),
    planId: uuid("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id),
    billingCycle: text("billing_cycle").$type<BillingCycle>().notNull(),
    amountMinor: money("amount_minor").notNull(),
    currency: text("currency").notNull(),
    status: text("status").$type<PaymentOrderStatus>().notNull().default("CREATED"),
    providerPaymentId: text("provider_payment_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    /**
     * The buyer's GA4 client id, recorded only when they had opted in to
     * analytics at checkout, so a webhook-confirmed payment's growth events
     * respect that choice. Null otherwise; cleared when the order is paid, or
     * after 48 hours by the scheduled sweep (jobs/subscriptions) if it never is.
     */
    analyticsClientId: text("analytics_client_id"),
    paidAt: tstz("paid_at"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("payment_orders_provider_order_uq").on(t.provider, t.providerOrderId),
    index("payment_orders_organization_idx").on(t.organizationId, t.createdAt),
    check("payment_orders_status_ck", sql`${t.status} in ('CREATED', 'PAID', 'FAILED', 'EXPIRED')`),
  ],
);

/**
 * Every verified webhook delivery, keyed by the provider's event id so a
 * redelivery is a no-op. Only a hash of the payload is kept.
 */
export const paymentEvents = pgTable(
  "payment_events",
  {
    id: id(),
    provider: text("provider").notNull(),
    eventId: text("event_id").notNull(),
    /** Null when the event names no order of ours (ignored event types, unknown orders). */
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    type: text("type").notNull(),
    payloadHash: text("payload_hash").notNull(),
    receivedAt: tstz("received_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payment_events_event_uq").on(t.provider, t.eventId),
    index("payment_events_organization_idx").on(t.organizationId, t.receivedAt),
  ],
);
