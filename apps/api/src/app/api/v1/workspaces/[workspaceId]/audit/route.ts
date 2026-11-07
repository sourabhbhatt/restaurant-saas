import { z } from "zod";

import { auditQuerySchema } from "@ros/contracts/platform";
import { platformService } from "@/composition/platform";
import { route } from "@ros/application/http/route";

/** Workspace audit log (paginated; filter by action, actor, type and date). */
export const GET = route(
  { auth: "user", params: z.object({ workspaceId: z.uuid() }), query: auditQuerySchema },
  async ({ actor, params, query, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    return { data: await platformService(c).listWorkspaceAudit(scope, query) };
  },
);
