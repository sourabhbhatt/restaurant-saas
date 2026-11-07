import { z } from "zod";

import { staffPlaceOrderSchema } from "@ros/contracts/orders";
import { orderingService } from "@/server/composition/ordering";
import { route } from "@/server/http/route";

/**
 * POST /api/v1/branches/:branchId/orders — a staff member (orders.create)
 * adds items to a table; opens the table session if none is open. Created as
 * ACCEPTED (staff-entered orders need no approval). Idempotent via the body's
 * idempotencyKey: 201 for a new order, 200 for a replay.
 */
export const POST = route(
  {
    auth: "user",
    params: z.object({ branchId: z.uuid() }),
    body: staffPlaceOrderSchema,
    rateLimit: { name: "staff-order", limit: 120, windowMs: 10 * 60_000 },
  },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    const { order, replay } = await orderingService(c).placeStaffOrder(scope, body, meta);
    return { status: replay ? 200 : 201, data: order };
  },
);
