import { z } from "zod";

import { subscriptionReasonSchema } from "@/contracts/platform";
import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

/** Cancel: no renewal, access until the period end. */
export const POST = route(
  { auth: "platform", params: z.object({ workspaceId: z.uuid() }), body: subscriptionReasonSchema },
  async ({ actor, params, body, meta, c }) => {
    await platformService(c).cancelSubscription(actor, params.workspaceId, body, meta);
    return { data: { ok: true } };
  },
);
