import { z } from "zod";

import { orderPrioritySchema } from "@ros/contracts/orders";
import { staffOpsService } from "@/composition/staff-ops";
import { route } from "@ros/application/http/route";

/** Change ticket priority (orders.approve or kitchen.update). */
export const PATCH = route(
  { auth: "user", params: z.object({ orderId: z.uuid() }), body: orderPrioritySchema },
  async ({ actor, params, body, meta, c }) => ({
    data: await staffOpsService(c).setPriority(actor, params.orderId, body, meta),
  }),
);
