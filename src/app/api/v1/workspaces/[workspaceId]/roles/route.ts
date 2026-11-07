import { z } from "zod";

import { createRoleSchema } from "@ros/contracts/tenancy";
import { tenancyService } from "@/server/composition/tenancy";
import { route } from "@/server/http/route";

const params = z.object({ workspaceId: z.uuid() });

/** System role templates plus this workspace's custom roles, with permissions. */
export const GET = route({ auth: "user", params }, async ({ actor, params, c }) => {
  const scope = await c.access.forWorkspace(actor, params.workspaceId);
  return { data: await tenancyService(c).listRoles(scope) };
});

export const POST = route(
  { auth: "user", params, body: createRoleSchema },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    return { status: 201, data: await tenancyService(c).createRole(scope, body, meta) };
  },
);
