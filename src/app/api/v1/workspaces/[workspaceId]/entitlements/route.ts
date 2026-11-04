import { z } from "zod";

import { route } from "@/server/http/route";

/** Effective plan, limits, features and trial state, plus current usage. */
export const GET = route(
  { auth: "user", params: z.object({ workspaceId: z.uuid() }) },
  async ({ actor, params, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    const usage = await c.entitlements.getUsage(scope.workspaceId);
    return { data: { entitlements: scope.entitlements, usage } };
  },
);
