import { z } from "zod";

import { analyticsService } from "@/server/composition/analytics";
import { route } from "@/server/http/route";

/** Live operational snapshot for the branch overview; sections gated per permission. */
export const GET = route(
  { auth: "user", params: z.object({ branchId: z.uuid() }) },
  async ({ actor, params, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    return { data: await analyticsService(c).live(scope) };
  },
);
