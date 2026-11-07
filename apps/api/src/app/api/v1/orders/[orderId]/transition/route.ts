import { z } from "zod";

import { orderTransitionSchema } from "@ros/contracts/orders";
import { staffOpsService } from "@/composition/staff-ops";
import { route } from "@ros/application/http/route";

/**
 * Order lifecycle transition; permission depends on the action. 409 on stale version.
 * An Idempotency-Key (sent by the offline outbox) replays the first answer to a resend.
 */
export const POST = route(
  {
    auth: "user",
    params: z.object({ orderId: z.uuid() }),
    body: orderTransitionSchema,
    idempotency: ({ params }) => `order-transition:${params.orderId}`,
  },
  async ({ actor, params, body, meta, c }) => ({
    data: await staffOpsService(c).transition(actor, params.orderId, body, meta),
  }),
);
