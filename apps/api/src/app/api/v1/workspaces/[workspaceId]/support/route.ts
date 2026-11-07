import { z } from "zod";

import { createSupportRequestSchema, supportListQuerySchema } from "@ros/contracts/platform";
import { platformService } from "@/composition/platform";
import { route } from "@ros/application/http/route";

const params = z.object({ workspaceId: z.uuid() });

/** Support requests of the workspace (all with workspace.support.manage, else only mine). */
export const GET = route(
  {
    auth: "user",
    params,
    query: supportListQuerySchema.pick({
      status: true,
      category: true,
      page: true,
      pageSize: true,
    }),
  },
  async ({ actor, params, query, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    return { data: await platformService(c).listWorkspaceSupport(scope, query) };
  },
);

export const POST = route(
  {
    auth: "user",
    params,
    body: createSupportRequestSchema,
    rateLimit: { name: "support-request", limit: 10, windowMs: 60 * 60_000 },
  },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    const created = await platformService(c).createSupportRequest(scope, body, meta);
    return { status: 201, data: created };
  },
);
