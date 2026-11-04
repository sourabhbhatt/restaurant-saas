import { z } from "zod";

import { createAssignmentSchema } from "@/contracts/tenancy";
import { tenancyService } from "@/server/composition/tenancy";
import { route } from "@/server/http/route";

export const POST = route(
  {
    auth: "user",
    params: z.object({ workspaceId: z.uuid(), membershipId: z.uuid() }),
    body: createAssignmentSchema,
  },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    const data = await tenancyService(c).addAssignment(
      scope,
      params.membershipId,
      { roleId: body.roleId, restaurantId: body.restaurantId, branchId: body.branchId ?? null },
      meta,
    );
    return { status: 201, data };
  },
);
