import type { PaymentOrderStatus } from "@ros/contracts/payments";
import type { BillingCycle } from "@ros/domain/subscriptions/entitlements";
import type { AuditRepository } from "@/server/ports/core-repositories";

import type { PlatformRepository } from "../platform/ports";

export interface PaymentOrderRow {
  id: string;
  organizationId: string;
  provider: string;
  providerOrderId: string;
  planId: string;
  planKey: string;
  billingCycle: BillingCycle;
  amountMinor: number;
  currency: string;
  status: PaymentOrderStatus;
  providerPaymentId: string | null;
  createdBy: string | null;
  createdAt: Date;
  paidAt: Date | null;
}

export interface PaymentRepository {
  /** The caller's membership row, visible to a tenant transaction only for the caller's own rows. */
  findMembership(
    organizationId: string,
    userId: string,
  ): Promise<{ role: "OWNER" | "BILLING_ADMIN" } | null>;
  findOrganization(
    organizationId: string,
  ): Promise<{ id: string; name: string; status: "ACTIVE" | "SUSPENDED" } | null>;
  /** The organization's first workspace: where subscription rows are keyed (dual-write). */
  findBillingWorkspace(organizationId: string): Promise<{ id: string; name: string } | null>;
  insertOrder(input: {
    id: string;
    organizationId: string;
    provider: string;
    providerOrderId: string;
    planId: string;
    billingCycle: BillingCycle;
    amountMinor: number;
    currency: string;
    createdBy: string;
  }): Promise<PaymentOrderRow>;
  findOrder(provider: string, providerOrderId: string): Promise<PaymentOrderRow | null>;
  /** `SELECT ... FOR UPDATE`: serialises the webhook and the verify endpoint on one order. */
  lockOrder(provider: string, providerOrderId: string): Promise<PaymentOrderRow | null>;
  markOrder(
    id: string,
    patch: { status: PaymentOrderStatus; providerPaymentId?: string | null; paidAt?: Date | null },
  ): Promise<void>;
  /** False when the provider already delivered this event (unique on provider + event id). */
  insertEvent(input: {
    provider: string;
    eventId: string;
    organizationId: string | null;
    type: string;
    payloadHash: string;
  }): Promise<boolean>;
}

/** The subscription path shared with Super Admin activation (platform module). */
export type SubscriptionWriter = Pick<
  PlatformRepository,
  | "findPlanById"
  | "findPlanByKey"
  | "findCurrentSubscription"
  | "retireCurrentSubscription"
  | "insertSubscription"
  | "insertSubscriptionEvent"
  | "listWorkspaceOwners"
  | "notify"
>;

export interface PaymentRepos {
  payments: PaymentRepository;
  platform: SubscriptionWriter;
  audit: AuditRepository;
}
