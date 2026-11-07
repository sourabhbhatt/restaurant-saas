import { z } from "zod";

import { onboardingProgressSchema } from "@ros/contracts/workspaces";
import { workspaceService } from "@/server/composition/workspaces";
import { route } from "@/server/http/route";

export const PUT = route(
  { auth: "user", params: z.object({ workspaceId: z.uuid() }), body: onboardingProgressSchema },
  async ({ actor, params, body, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    return { data: await workspaceService(c).updateOnboarding(scope, body) };
  },
);
