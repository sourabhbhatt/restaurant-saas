import { z } from "zod";

import { updateRoleSchema } from "@ros/contracts/tenancy";
import { tenancyService } from "@/composition/tenancy";
import { route } from "@ros/application/http/route";

const params = z.object({ workspaceId: z.uuid(), roleId: z.uuid() });

export const PATCH = route(
  { auth: "user", params, body: updateRoleSchema },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    return { data: await tenancyService(c).updateRole(scope, params.roleId, body, meta) };
  },
);

export const DELETE = route({ auth: "user", params }, async ({ actor, params, meta, c }) => {
  const scope = await c.access.forWorkspace(actor, params.workspaceId);
  await tenancyService(c).deleteRole(scope, params.roleId, meta);
  return { data: { ok: true } };
});
