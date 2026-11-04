import { z } from "zod";

import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

/**
 * Subscription overview: entitlements, usage, current plan, public plans and
 * history. Readable even while suspended/restricted (owners must see why).
 */
export const GET = route(
  { auth: "user", params: z.object({ workspaceId: z.uuid() }) },
  async ({ actor, params, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    return { data: await platformService(c).getSubscriptionOverview(scope) };
  },
);
