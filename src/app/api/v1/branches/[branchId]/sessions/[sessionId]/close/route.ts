import { z } from "zod";

import { billingService } from "@/server/composition/billing";
import { route } from "@/server/http/route";

/**
 * Close a table session under the branch's closure rules (sessions.manage).
 * 409 CONFLICT with `details.reasons` when closing is not allowed yet.
 */
export const POST = route(
  { auth: "user", params: z.object({ branchId: z.uuid(), sessionId: z.uuid() }) },
  async ({ actor, params, meta, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    return { data: await billingService(c).closeSession(scope, params.sessionId, meta) };
  },
);
