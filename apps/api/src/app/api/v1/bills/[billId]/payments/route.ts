import { z } from "zod";

import { recordPaymentSchema } from "@ros/contracts/billing";
import { billingService, scopeForBill } from "@/composition/billing";
import { route } from "@ros/application/http/route";

/**
 * Record a payment (payments.record). Idempotent by body `idempotencyKey`
 * (per branch) and the Idempotency-Key header: a replay returns the original
 * payment with 200 and never counts twice.
 */
export const POST = route(
  {
    auth: "user",
    params: z.object({ billId: z.uuid() }),
    body: recordPaymentSchema,
    idempotency: ({ params }) => `payment:${params.billId}`,
    rateLimit: { name: "billing.payment", limit: 120, windowMs: 60_000 },
  },
  async ({ actor, params, body, meta, c }) => {
    const scope = await scopeForBill(c, actor, params.billId);
    const result = await billingService(c).recordPayment(scope, params.billId, body, meta);
    return { status: result.replayed ? 200 : 201, data: result };
  },
);
