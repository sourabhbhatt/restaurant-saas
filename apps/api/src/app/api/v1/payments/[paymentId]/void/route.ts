import { z } from "zod";

import { voidSchema } from "@ros/contracts/billing";
import { billingService, scopeForPayment } from "@/composition/billing";
import { route } from "@ros/application/http/route";

/** Void a payment or refund entry; the bill balance is recomputed (payments.refund). */
export const POST = route(
  { auth: "user", params: z.object({ paymentId: z.uuid() }), body: voidSchema },
  async ({ actor, params, body, meta, c }) => {
    const scope = await scopeForPayment(c, actor, params.paymentId);
    return {
      data: await billingService(c).voidPayment(scope, params.paymentId, body.reason, meta),
    };
  },
);
