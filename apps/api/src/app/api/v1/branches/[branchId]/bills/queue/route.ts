import { z } from "zod";

import { billingService } from "@/composition/billing";
import { route } from "@ros/application/http/route";

/** Cashier queue: sessions awaiting a bill and live bills not yet closed (bills.view). */
export const GET = route(
  { auth: "user", params: z.object({ branchId: z.uuid() }) },
  async ({ actor, params, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    return { data: await billingService(c).queue(scope) };
  },
);
