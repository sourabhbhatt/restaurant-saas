import { z } from "zod";

import { verifyCheckoutSchema } from "@ros/contracts/payments";
import { paymentService } from "@/server/composition/payments";
import { route, uuidParam } from "@/server/http/route";

/**
 * Checkout's success callback. Activates the plan once the signature is
 * valid and the provider confirms a captured payment of the stored amount;
 * answers `status: "PENDING"` until then (the webhook may still activate).
 */
export const POST = route(
  {
    auth: "user",
    params: z.object({ organizationId: uuidParam }),
    body: verifyCheckoutSchema,
    rateLimit: { name: "checkout_verify", limit: 30, windowMs: 15 * 60_000 },
  },
  async ({ actor, params, body, meta, c }) => ({
    data: await paymentService(c).verifyCheckout(actor, params.organizationId, body, meta),
  }),
);
