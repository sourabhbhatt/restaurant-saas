import { z } from "zod";

import { staffOpsService } from "@/server/composition/staff-ops";
import { route } from "@/server/http/route";

/** One table session: its orders and bill summary (tables.view). */
export const GET = route(
  { auth: "user", params: z.object({ branchId: z.uuid(), sessionId: z.uuid() }) },
  async ({ actor, params, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    return { data: await staffOpsService(c).getSession(scope, params.sessionId) };
  },
);
