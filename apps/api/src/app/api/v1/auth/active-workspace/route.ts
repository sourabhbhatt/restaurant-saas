import { z } from "zod";

import { route } from "@ros/application/http/route";

/** Switch the active workspace. Membership is verified before it is stored. */
export const PUT = route(
  { auth: "user", body: z.object({ workspaceId: z.uuid() }) },
  async ({ body, actor, c }) => {
    const scope = await c.access.forWorkspace(actor, body.workspaceId);
    await c.identity.setActiveWorkspace(actor.sessionId, scope.workspaceId);
    return { data: { activeWorkspaceId: scope.workspaceId } };
  },
);
