import { z } from "zod";

import { orderItemStatusSchema } from "@/contracts/orders";
import { staffOpsService } from "@/server/composition/staff-ops";
import { route } from "@/server/http/route";

/** Item-level kitchen status (kitchen.update). All items READY moves the order to READY. */
export const PATCH = route(
  {
    auth: "user",
    params: z.object({ orderId: z.uuid(), itemId: z.uuid() }),
    body: orderItemStatusSchema,
  },
  async ({ actor, params, body, meta, c }) => ({
    data: await staffOpsService(c).setItemStatus(actor, params.orderId, params.itemId, body, meta),
  }),
);
