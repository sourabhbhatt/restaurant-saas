import { z } from "zod";

import { staffOrderListQuerySchema } from "@ros/contracts/staff-ops";
import { staffOpsService } from "@/server/composition/staff-ops";
import { route } from "@/server/http/route";

/** GET /api/v1/branches/:branchId/orders — branch order list (orders.view). */
export const GET = route(
  { auth: "user", params: z.object({ branchId: z.uuid() }), query: staffOrderListQuerySchema },
  async ({ actor, params, query, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    const orders = await staffOpsService(c).listOrders(scope, query);
    return { data: orders };
  },
);
