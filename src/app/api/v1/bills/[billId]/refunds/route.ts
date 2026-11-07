import { z } from "zod";

import { refundSchema } from "@ros/contracts/billing";
import { billingService, scopeForBill } from "@/server/composition/billing";
import { route } from "@/server/http/route";

/** Record a refund against a bill (payments.refund). Idempotent by body `idempotencyKey`. */
export const POST = route(
  {
    auth: "user",
    params: z.object({ billId: z.uuid() }),
    body: refundSchema,
    idempotency: ({ params }) => `refund:${params.billId}`,
  },
  async ({ actor, params, body, meta, c }) => {
    const scope = await scopeForBill(c, actor, params.billId);
    const result = await billingService(c).refund(scope, params.billId, body, meta);
    return { status: result.replayed ? 200 : 201, data: result };
  },
);
