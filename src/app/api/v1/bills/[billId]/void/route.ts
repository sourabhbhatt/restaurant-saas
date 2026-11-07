import { z } from "zod";

import { voidSchema } from "@ros/contracts/billing";
import { billingService, scopeForBill } from "@/composition/billing";
import { route } from "@ros/application/http/route";

/** Void an issued bill with no net payments (bills.void); the table can then be re-billed. */
export const POST = route(
  { auth: "user", params: z.object({ billId: z.uuid() }), body: voidSchema },
  async ({ actor, params, body, meta, c }) => {
    const scope = await scopeForBill(c, actor, params.billId);
    return { data: await billingService(c).voidBill(scope, params.billId, body.reason, meta) };
  },
);
