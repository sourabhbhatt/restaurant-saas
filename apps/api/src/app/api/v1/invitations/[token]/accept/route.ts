import { z } from "zod";

import { invitationTokenParam } from "@ros/contracts/tenancy";
import { tenancyService } from "@/composition/tenancy";
import { route } from "@ros/application/http/route";

export const POST = route(
  {
    auth: "user",
    params: z.object({ token: invitationTokenParam }),
    rateLimit: { name: "invitation_accept", limit: 20, windowMs: 15 * 60_000 },
  },
  async ({ actor, params, meta, c }) => {
    const result = await tenancyService(c).acceptInvitation(actor, params.token, meta);
    await c.identity.setActiveWorkspace(actor.sessionId, result.workspaceId);
    return { data: result };
  },
);
