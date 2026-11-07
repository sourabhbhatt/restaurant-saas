import { z } from "zod";

import { subscriptionReasonSchema } from "@ros/contracts/platform";
import { platformService } from "@/composition/platform";
import { route } from "@ros/application/http/route";

/** Cancel: no renewal, access until the period end. */
export const POST = route(
  { auth: "platform", params: z.object({ workspaceId: z.uuid() }), body: subscriptionReasonSchema },
  async ({ actor, params, body, meta, c }) => {
    await platformService(c).cancelSubscription(actor, params.workspaceId, body, meta);
    return { data: { ok: true } };
  },
);
