import { z } from "zod";

import { rejectUpgradeSchema } from "@/contracts/upgrades";
import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

/** Reject with a reason; the subscription is unchanged. */
export const POST = route(
  { auth: "platform", params: z.object({ requestId: z.uuid() }), body: rejectUpgradeSchema },
  async ({ actor, params, body, meta, c }) => ({
    data: await platformService(c).rejectUpgradeRequest(actor, params.requestId, body.reason, meta),
  }),
);
