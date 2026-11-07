import { z } from "zod";

import { analyticsRangeQuerySchema } from "@ros/contracts/analytics";
import { analyticsService } from "@/composition/analytics";
import { route } from "@ros/application/http/route";

/** Branch reports: sales, menu, kitchen, cashier and tables. Requires `reports.view`. */
export const GET = route(
  { auth: "user", params: z.object({ branchId: z.uuid() }), query: analyticsRangeQuerySchema },
  async ({ actor, params, query, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    return { data: await analyticsService(c).branch(scope, query) };
  },
);
