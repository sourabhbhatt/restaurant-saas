import { z } from "zod";

import type { WorkspaceStructureDto } from "@ros/contracts/structure";
import { route } from "@/server/http/route";

export const GET = route(
  { auth: "user", params: z.object({ workspaceId: z.uuid() }) },
  async ({ actor, params, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    const all = await c.repos.access.listStructure(scope.workspaceId);
    const filter = scope.branchFilter();
    const restaurants = filter
      ? all
          .filter(
            (r) =>
              filter.restaurantIds.includes(r.id) ||
              r.branches.some((b) => filter.branchIds.includes(b.id)),
          )
          .map((r) => ({
            ...r,
            branches: filter.restaurantIds.includes(r.id)
              ? r.branches
              : r.branches.filter((b) => filter.branchIds.includes(b.id)),
          }))
      : all;
    const data: WorkspaceStructureDto = {
      workspaceId: scope.workspaceId,
      workspaceName: scope.workspaceName,
      roleKey: scope.roleKey,
      roleLabel: scope.roleLabel(),
      permissions: c.access.describe(scope),
      restaurants,
      entitlements: scope.entitlements,
    };
    return { data };
  },
);
