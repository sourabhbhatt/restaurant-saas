import { z } from "zod";

import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

/** Request details with full history and internal notes. */
export const GET = route(
  { auth: "platform", params: z.object({ requestId: z.uuid() }) },
  async ({ actor, params, c }) => ({
    data: await platformService(c).getUpgradeRequest(actor, params.requestId),
  }),
);
