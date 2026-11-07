import { z } from "zod";

import { createUpgradeRequestSchema } from "@ros/contracts/upgrades";
import { platformService } from "@/composition/platform";
import { route } from "@ros/application/http/route";

const params = z.object({ workspaceId: z.uuid() });

/** Upgrade requests of this workspace (workspace.subscription.view). */
export const GET = route({ auth: "user", params }, async ({ actor, params, c }) => {
  const scope = await c.access.forWorkspace(actor, params.workspaceId);
  return { data: await platformService(c).listWorkspaceUpgradeRequests(scope) };
});

/** Ask Super Admin to move the workspace to another plan (workspace.subscription.manage). */
export const POST = route(
  {
    auth: "user",
    params,
    body: createUpgradeRequestSchema,
    rateLimit: { name: "upgrade_request", limit: 10, windowMs: 60 * 60_000 },
  },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    return { status: 201, data: await platformService(c).createUpgradeRequest(scope, body, meta) };
  },
);
