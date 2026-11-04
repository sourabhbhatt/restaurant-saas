import { z } from "zod";

import { createInvitationSchema } from "@/contracts/tenancy";
import { tenancyService } from "@/server/composition/tenancy";
import { route } from "@/server/http/route";

const params = z.object({ workspaceId: z.uuid() });

export const GET = route({ auth: "user", params }, async ({ actor, params, c }) => {
  const scope = await c.access.forWorkspace(actor, params.workspaceId);
  return { data: await tenancyService(c).listInvitations(scope) };
});

export const POST = route(
  {
    auth: "user",
    params,
    body: createInvitationSchema,
    rateLimit: { name: "invitation_create", limit: 60, windowMs: 60 * 60_000 },
  },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    return { status: 201, data: await tenancyService(c).createInvitation(scope, body, meta) };
  },
);
