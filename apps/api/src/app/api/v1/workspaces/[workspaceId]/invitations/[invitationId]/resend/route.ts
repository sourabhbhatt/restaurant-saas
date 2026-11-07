import { z } from "zod";

import { tenancyService } from "@/composition/tenancy";
import { route } from "@ros/application/http/route";

/** Issue a fresh link (the old one stops working), extend expiry and email it again. */
export const POST = route(
  {
    auth: "user",
    params: z.object({ workspaceId: z.uuid(), invitationId: z.uuid() }),
    rateLimit: { name: "invitation_resend", limit: 30, windowMs: 60 * 60_000 },
  },
  async ({ actor, params, meta, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    return { data: await tenancyService(c).resendInvitation(scope, params.invitationId, meta) };
  },
);
