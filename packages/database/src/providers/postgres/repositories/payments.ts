import { and, asc, eq, isNull, type SQL } from "drizzle-orm";

import type { PaymentOrderRow, PaymentRepository } from "@ros/application/modules/payments/ports";

import type { Executor } from "../client";
import {
  organizationMembers,
  organizations,
  paymentEvents,
  paymentOrders,
  subscriptionPlans,
  workspaces,
} from "../schema";

type OrderJoin = { order: typeof paymentOrders.$inferSelect; planKey: string };

function toOrderRow({ order, planKey }: OrderJoin): PaymentOrderRow {
  return {
    id: order.id,
    organizationId: order.organizationId,
    provider: order.provider,
    providerOrderId: order.providerOrderId,
    planId: order.planId,
    planKey,
    billingCycle: order.billingCycle,
    amountMinor: order.amountMinor,
    currency: order.currency,
    status: order.status,
    providerPaymentId: order.providerPaymentId,
    createdBy: order.createdBy,
    analyticsClientId: order.analyticsClientId,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
  };
}

export function paymentRepository(db: Executor): PaymentRepository {
  async function orderWhere(where: SQL, lock = false) {
    const query = db
      .select({ order: paymentOrders, planKey: subscriptionPlans.key })
      .from(paymentOrders)
      .innerJoin(subscriptionPlans, eq(subscriptionPlans.id, paymentOrders.planId))
      .where(where)
      .limit(1);
    // The lock lands on payment_orders only: the plan row is reference data.
    const [row] = lock ? await query.for("update", { of: paymentOrders }) : await query;
    return row ? toOrderRow(row) : null;
  }

  return {
    async findMembership(organizationId, userId) {
      const [row] = await db
        .select({ role: organizationMembers.role })
        .from(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, userId),
          ),
        )
        .limit(1);
      return row ?? null;
    },
    async findOrganization(organizationId) {
      const [row] = await db
        .select({ id: organizations.id, name: organizations.name, status: organizations.status })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);
      return row ?? null;
    },
    async findBillingWorkspace(organizationId) {
      const [row] = await db
        .select({ id: workspaces.id, name: workspaces.name })
        .from(workspaces)
        .where(and(eq(workspaces.organizationId, organizationId), isNull(workspaces.deletedAt)))
        .orderBy(asc(workspaces.createdAt), asc(workspaces.id))
        .limit(1);
      return row ?? null;
    },
    async insertOrder(input) {
      await db.insert(paymentOrders).values({ ...input, status: "CREATED" });
      const row = await orderWhere(eq(paymentOrders.id, input.id));
      if (!row) throw new Error("payment order vanished after insert");
      return row;
    },
    async findOrder(provider, providerOrderId) {
      return orderWhere(
        and(
          eq(paymentOrders.provider, provider),
          eq(paymentOrders.providerOrderId, providerOrderId),
        )!,
      );
    },
    async lockOrder(provider, providerOrderId) {
      return orderWhere(
        and(
          eq(paymentOrders.provider, provider),
          eq(paymentOrders.providerOrderId, providerOrderId),
        )!,
        true,
      );
    },
    async markOrder(id, patch) {
      const set: Partial<typeof paymentOrders.$inferInsert> = { status: patch.status };
      if (patch.providerPaymentId !== undefined) set.providerPaymentId = patch.providerPaymentId;
      if (patch.paidAt !== undefined) set.paidAt = patch.paidAt;
      if (patch.analyticsClientId !== undefined) set.analyticsClientId = patch.analyticsClientId;
      await db.update(paymentOrders).set(set).where(eq(paymentOrders.id, id));
    },
    async insertEvent(input) {
      const rows = await db
        .insert(paymentEvents)
        .values(input)
        .onConflictDoNothing({ target: [paymentEvents.provider, paymentEvents.eventId] })
        .returning({ id: paymentEvents.id });
      return rows.length > 0;
    },
  };
}
