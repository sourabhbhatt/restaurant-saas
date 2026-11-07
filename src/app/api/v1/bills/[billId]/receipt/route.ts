import { z } from "zod";

import { billingService, scopeForBill } from "@/composition/billing";
import { route } from "@ros/application/http/route";

/** Bill plus restaurant/branch details for printing a receipt (bills.view). */
export const GET = route(
  { auth: "user", params: z.object({ billId: z.uuid() }) },
  async ({ actor, params, c }) => {
    const scope = await scopeForBill(c, actor, params.billId);
    return { data: await billingService(c).receipt(scope, params.billId) };
  },
);
