import { z } from "zod";

import { staffOpsService } from "@/composition/staff-ops";
import { route } from "@ros/application/http/route";

/** Order detail with timeline (orders.view or kitchen.view). */
export const GET = route(
  { auth: "user", params: z.object({ orderId: z.uuid() }) },
  async ({ actor, params, c }) => ({
    data: await staffOpsService(c).getOrder(actor, params.orderId),
  }),
);
