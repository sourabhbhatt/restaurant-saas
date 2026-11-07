import { createSystemLookup } from "@ros/database/providers/postgres/client";
import { billingRepository } from "@ros/database/providers/postgres/repositories/billing";
import { auditRepository } from "@ros/database/providers/postgres/repositories/core";
import { DomainError, notFound } from "@ros/domain/shared/errors";

import type { BranchScope } from "@ros/application/authz/access-service";
import type { Container } from "./container";
import { tenantRunner } from "./runners";
import type { UserActor } from "@ros/application/context";
import { createBillingService } from "@ros/application/modules/billing/service";

/** Billing wiring: binds the billing ports to the Postgres adapter. */
export function billingService(c: Container) {
  return createBillingService({
    tx: tenantRunner(c, (e) => ({
      billing: billingRepository(e),
      audit: auditRepository(e),
    })),
    clock: c.clock,
    realtime: c.realtime,
    logger: c.logger,
  });
}

/** Resolve the branch that owns a bill or payment (for scope resolution only). */
export function billingLookup(c: Container) {
  // System: finds the branch owning a bill/payment id; the access service then authorizes and binds.
  const lookup = createSystemLookup(c.db, billingRepository, [
    "findBillBranchId",
    "findPaymentBranchId",
  ]);
  return {
    billBranchId: (billId: string) => lookup.findBillBranchId(billId),
    paymentBranchId: (paymentId: string) => lookup.findPaymentBranchId(paymentId),
  };
}

async function scopeVia(
  c: Container,
  actor: UserActor,
  branchId: string | null,
  what: string,
): Promise<BranchScope> {
  if (!branchId) throw notFound(what);
  try {
    return await c.access.forBranch(actor, branchId);
  } catch (error) {
    // Never reveal that the resource exists in a branch the actor can't see.
    if (error instanceof DomainError && error.code === "NOT_FOUND") throw notFound(what);
    throw error;
  }
}

/** Branch scope for a bill id from the URL (404 for other tenants' bills). */
export async function scopeForBill(c: Container, actor: UserActor, billId: string) {
  return scopeVia(c, actor, await billingLookup(c).billBranchId(billId), "Bill");
}

/** Branch scope for a payment id from the URL (404 for other tenants' payments). */
export async function scopeForPayment(c: Container, actor: UserActor, paymentId: string) {
  return scopeVia(c, actor, await billingLookup(c).paymentBranchId(paymentId), "Payment");
}
