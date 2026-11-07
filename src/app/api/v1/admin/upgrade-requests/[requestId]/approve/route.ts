import { z } from "zod";

import { approveUpgradeSchema } from "@ros/contracts/upgrades";
import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

/** Approve: activates the requested plan and notifies the owners. */
export const POST = route(
  { auth: "platform", params: z.object({ requestId: z.uuid() }), body: approveUpgradeSchema },
  async ({ actor, params, body, meta, c }) => ({
    data: await platformService(c).approveUpgradeRequest(actor, params.requestId, body, meta),
  }),
);
