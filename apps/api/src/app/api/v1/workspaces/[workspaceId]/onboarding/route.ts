import { z } from "zod";

import { onboardingProgressSchema } from "@ros/contracts/workspaces";
import { workspaceService } from "@/composition/workspaces";
import { route } from "@ros/application/http/route";

export const PUT = route(
  { auth: "user", params: z.object({ workspaceId: z.uuid() }), body: onboardingProgressSchema },
  async ({ actor, params, body, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    return { data: await workspaceService(c).updateOnboarding(scope, body) };
  },
);
