import { z } from "zod";

import { updateWorkspaceSchema } from "@/contracts/workspaces";
import { workspaceService } from "@/server/composition/workspaces";
import { route } from "@/server/http/route";

const params = z.object({ workspaceId: z.uuid() });

export const GET = route({ auth: "user", params }, async ({ actor, params, c }) => {
  const scope = await c.access.forWorkspace(actor, params.workspaceId);
  const workspace = await workspaceService(c).get(scope);
  return {
    data: {
      workspace,
      membership: { roleKey: scope.roleKey, permissions: c.access.describe(scope) },
    },
  };
});

export const PATCH = route(
  { auth: "user", params, body: updateWorkspaceSchema },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    const { version, ...patch } = body;
    const workspace = await workspaceService(c).update(scope, patch, version, meta);
    return { data: workspace };
  },
);
