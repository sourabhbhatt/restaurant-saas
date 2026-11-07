import { z } from "zod";

import { activateSubscriptionSchema } from "@ros/contracts/platform";
import { platformService } from "@/composition/platform";
import { route } from "@ros/application/http/route";

/** Assign a plan and manually activate a paid subscription. */
export const POST = route(
  {
    auth: "platform",
    params: z.object({ workspaceId: z.uuid() }),
    body: activateSubscriptionSchema,
  },
  async ({ actor, params, body, meta, c }) => {
    await platformService(c).activateSubscription(actor, params.workspaceId, body, meta);
    return { data: { ok: true } };
  },
);
