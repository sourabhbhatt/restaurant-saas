import { z } from "zod";

import type { BranchContextDto } from "@/contracts/structure";
import { route } from "@/server/http/route";

export const GET = route(
  { auth: "user", params: z.object({ branchId: z.uuid() }) },
  async ({ actor, params, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    const data: BranchContextDto = {
      workspaceId: scope.workspaceId,
      workspaceName: scope.workspaceName,
      restaurantId: scope.restaurantId,
      restaurantName: scope.branch.restaurantName,
      branchId: scope.branchId,
      branchName: scope.branch.name,
      currency: scope.branch.currency,
      timezone: scope.branch.timezone,
      permissions: c.access.describe(scope),
      entitlements: scope.entitlements,
    };
    return { data };
  },
);
