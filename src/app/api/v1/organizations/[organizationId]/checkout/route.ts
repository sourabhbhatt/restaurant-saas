import { z } from "zod";

import { createCheckoutSchema } from "@/contracts/payments";
import { paymentService } from "@/server/composition/payments";
import { route, uuidParam } from "@/server/http/route";

/**
 * Starts an online payment for one billing period: creates the provider
 * order at the plan's own price and returns what Checkout needs to open.
 * Organization owners and billing admins only; others get 404.
 */
export const POST = route(
  {
    auth: "user",
    params: z.object({ organizationId: uuidParam }),
    body: createCheckoutSchema,
    rateLimit: { name: "checkout", limit: 20, windowMs: 15 * 60_000 },
  },
  async ({ actor, params, body, meta, c }) => ({
    status: 201,
    data: await paymentService(c).createCheckout(actor, params.organizationId, body, meta),
  }),
);
