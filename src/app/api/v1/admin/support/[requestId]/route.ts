import { z } from "zod";

import { updateSupportRequestSchema } from "@ros/contracts/platform";
import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

const params = z.object({ requestId: z.uuid() });

export const GET = route({ auth: "platform", params }, async ({ actor, params, c }) => ({
  data: await platformService(c).getSupport(actor, params.requestId),
}));

/** Status, priority and assignment ("me" / null). */
export const PATCH = route(
  { auth: "platform", params, body: updateSupportRequestSchema },
  async ({ actor, params, body, meta, c }) => ({
    data: await platformService(c).updateSupport(actor, params.requestId, body, meta),
  }),
);
