import { z } from "zod";

import { subscriptionReasonSchema } from "@ros/contracts/platform";
import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

/** Expire the subscription now (workspace becomes restricted). */
export const POST = route(
  { auth: "platform", params: z.object({ workspaceId: z.uuid() }), body: subscriptionReasonSchema },
  async ({ actor, params, body, meta, c }) => {
    await platformService(c).expireSubscription(actor, params.workspaceId, body, meta);
    return { data: { ok: true } };
  },
);
