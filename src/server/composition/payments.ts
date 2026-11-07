import { createSystemRunner } from "@/infrastructure/database/providers/postgres/client";
import { auditRepository } from "@/infrastructure/database/providers/postgres/repositories/core";
import { paymentRepository } from "@/infrastructure/database/providers/postgres/repositories/payments";
import { platformRepository } from "@/infrastructure/database/providers/postgres/repositories/platform";

import type { Container } from "../container";
import { createPaymentService } from "../modules/payments/service";
import { tenantRunner } from "./runners";

/** Payments wiring: binds the payments module's ports to the Postgres adapters and the gateway. */
export function paymentService(c: Container) {
  return createPaymentService({
    // System: payment orders and events are read-only for tenants, and activation retires and
    // inserts the organization's subscription; the webhook has no user at all. Checkout and verify
    // run only after the tenant-scoped membership check below.
    tx: createSystemRunner(c.db, (db) => ({
      payments: paymentRepository(db),
      platform: platformRepository(db),
      audit: auditRepository(db),
    })),
    membership: tenantRunner(c, (e) => ({ payments: paymentRepository(e) })),
    gateway: c.payments,
    keyId: c.env.RAZORPAY_KEY_ID ?? null,
    clock: c.clock,
    logger: c.logger,
  });
}
