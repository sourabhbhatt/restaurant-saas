import { z } from "zod";

import { orderTransitionSchema } from "@/contracts/orders";
import { staffOpsService } from "@/server/composition/staff-ops";
import { route } from "@/server/http/route";

/** Order lifecycle transition; permission depends on the action. 409 on stale version. */
export const POST = route(
  { auth: "user", params: z.object({ orderId: z.uuid() }), body: orderTransitionSchema },
  async ({ actor, params, body, meta, c }) => ({
    data: await staffOpsService(c).transition(actor, params.orderId, body, meta),
  }),
);
