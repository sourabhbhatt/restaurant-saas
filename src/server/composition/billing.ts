import { createTransactionRunner } from "@/infrastructure/database/providers/postgres/client";
import { billingRepository } from "@/infrastructure/database/providers/postgres/repositories/billing";
import { auditRepository } from "@/infrastructure/database/providers/postgres/repositories/core";
import { DomainError, notFound } from "@/domain/shared/errors";

import type { BranchScope } from "../authz/access-service";
import type { Container } from "../container";
import type { UserActor } from "../context";
import { createBillingService } from "../modules/billing/service";

/** Billing wiring: binds the billing ports to the Postgres adapter. */
export function billingService(c: Container) {
  return createBillingService({
    tx: createTransactionRunner(c.db, (db) => ({
      billing: billingRepository(db),
      audit: auditRepository(db),
    })),
    clock: c.clock,
    realtime: c.realtime,
    logger: c.logger,
  });
}

/** Resolve the branch that owns a bill or payment (for scope resolution only). */
export function billingLookup(c: Container) {
  const repo = billingRepository(c.db);
  return {
    billBranchId: (billId: string) => repo.findBillBranchId(billId),
    paymentBranchId: (paymentId: string) => repo.findPaymentBranchId(paymentId),
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
