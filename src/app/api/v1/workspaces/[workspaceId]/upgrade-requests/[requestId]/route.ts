import { z } from "zod";

import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

/** Cancel a pending request of this workspace. */
export const DELETE = route(
  { auth: "user", params: z.object({ workspaceId: z.uuid(), requestId: z.uuid() }) },
  async ({ actor, params, meta, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    return { data: await platformService(c).cancelUpgradeRequest(scope, params.requestId, meta) };
  },
);
