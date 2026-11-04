import { z } from "zod";

import { staffOpsService } from "@/server/composition/staff-ops";
import { route } from "@/server/http/route";

/** Every table of the branch with derived status, open session and bill summary (tables.view). */
export const GET = route(
  { auth: "user", params: z.object({ branchId: z.uuid() }) },
  async ({ actor, params, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    return { data: await staffOpsService(c).listSessions(scope) };
  },
);
