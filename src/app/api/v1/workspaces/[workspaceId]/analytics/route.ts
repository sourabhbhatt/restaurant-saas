import { z } from "zod";

import { workspaceAnalyticsQuerySchema } from "@ros/contracts/analytics";
import { analyticsService } from "@/composition/analytics";
import { route } from "@ros/application/http/route";

/**
 * Consolidated workspace analytics. `workspace.analytics.view` (or
 * `reports.view` on specific restaurants/branches, which limits the report to
 * them). Feature `analytics`; branch comparison needs `advanced_analytics`.
 */
export const GET = route(
  {
    auth: "user",
    params: z.object({ workspaceId: z.uuid() }),
    query: workspaceAnalyticsQuerySchema,
  },
  async ({ actor, params, query, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    return { data: await analyticsService(c).workspace(scope, query) };
  },
);
