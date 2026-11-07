import { z } from "zod";

import { planInputSchema } from "@ros/contracts/platform";
import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

const params = z.object({ planId: z.uuid() });

export const GET = route({ auth: "platform", params }, async ({ actor, params, c }) => ({
  data: await platformService(c).getPlan(actor, params.planId),
}));

/** Full replace of the editable plan fields (no mass assignment of internal columns). */
export const PATCH = route(
  { auth: "platform", params, body: planInputSchema },
  async ({ actor, params, body, meta, c }) => ({
    data: await platformService(c).updatePlan(actor, params.planId, body, meta),
  }),
);
