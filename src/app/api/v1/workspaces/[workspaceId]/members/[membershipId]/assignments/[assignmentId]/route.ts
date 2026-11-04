import { z } from "zod";

import { tenancyService } from "@/server/composition/tenancy";
import { route } from "@/server/http/route";

export const DELETE = route(
  {
    auth: "user",
    params: z.object({ workspaceId: z.uuid(), membershipId: z.uuid(), assignmentId: z.uuid() }),
  },
  async ({ actor, params, meta, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    await tenancyService(c).removeAssignment(
      scope,
      params.membershipId,
      params.assignmentId,
      meta,
    );
    return { data: { ok: true } };
  },
);
