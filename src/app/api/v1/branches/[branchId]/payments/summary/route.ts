import { z } from "zod";

import { paymentSummaryQuerySchema } from "@ros/contracts/billing-extra";
import { billingService } from "@/composition/billing";
import { route } from "@ros/application/http/route";

/** Collections by method, refunds and outstanding balances (payments.summary.view). */
export const GET = route(
  { auth: "user", params: z.object({ branchId: z.uuid() }), query: paymentSummaryQuerySchema },
  async ({ actor, params, query, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    return { data: await billingService(c).summary(scope, query) };
  },
);
