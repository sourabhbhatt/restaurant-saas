import { z } from "zod";

import { previewBillSchema } from "@/contracts/billing";
import { billingService } from "@/server/composition/billing";
import { route } from "@/server/http/route";

/** Bill totals for a session computed from order snapshots, without saving (bills.generate). */
export const POST = route(
  { auth: "user", params: z.object({ branchId: z.uuid() }), body: previewBillSchema },
  async ({ actor, params, body, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    return { data: await billingService(c).preview(scope, body) };
  },
);
