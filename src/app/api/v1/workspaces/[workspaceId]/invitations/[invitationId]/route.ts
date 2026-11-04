import { z } from "zod";

import { tenancyService } from "@/server/composition/tenancy";
import { route } from "@/server/http/route";

/** Revoke a pending invitation. */
export const DELETE = route(
  { auth: "user", params: z.object({ workspaceId: z.uuid(), invitationId: z.uuid() }) },
  async ({ actor, params, meta, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    await tenancyService(c).revokeInvitation(scope, params.invitationId, meta);
    return { data: { ok: true } };
  },
);
