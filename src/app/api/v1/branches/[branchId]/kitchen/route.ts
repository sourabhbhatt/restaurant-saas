import { z } from "zod";

import { staffOpsService } from "@/server/composition/staff-ops";
import { route } from "@/server/http/route";

/** Kitchen display feed (kitchen.view). */
export const GET = route(
  { auth: "user", params: z.object({ branchId: z.uuid() }) },
  async ({ actor, params, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    return { data: await staffOpsService(c).kitchenFeed(scope) };
  },
);
