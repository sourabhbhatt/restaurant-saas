import { createTransactionRunner } from "@/infrastructure/database/providers/postgres/client";
import { billingRepository } from "@/infrastructure/database/providers/postgres/repositories/billing";
import { auditRepository } from "@/infrastructure/database/providers/postgres/repositories/core";

import type { Container } from "../container";
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
