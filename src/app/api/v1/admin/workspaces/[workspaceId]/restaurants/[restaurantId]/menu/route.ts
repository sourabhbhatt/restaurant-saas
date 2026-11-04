import { z } from "zod";

import type { AdminRestaurantMenuDto } from "@/contracts/menu";
import { notFound } from "@/domain/shared/errors";
import { menuService } from "@/server/composition/menu";
import { route } from "@/server/http/route";

/**
 * Super Admin: read-only menu of one restaurant. The restaurant must belong to
 * the workspace in the URL, otherwise it is reported as not found so one
 * tenant's menu is never shown in another tenant's context.
 */
export const GET = route(
  {
    auth: "platform",
    params: z.object({ workspaceId: z.uuid(), restaurantId: z.uuid() }),
  },
  async ({ params, c }) => {
    const ref = await c.repos.access.findRestaurantRef(params.restaurantId);
    if (!ref || ref.workspaceId !== params.workspaceId) throw notFound("Restaurant");
    const structure = await c.repos.access.listStructure(params.workspaceId);
    const restaurant = structure.find((r) => r.id === ref.id);
    if (!restaurant) throw notFound("Restaurant");
    const { menu, overrides } = await menuService(c).getTreeForAdmin({
      workspaceId: ref.workspaceId,
      restaurantId: ref.id,
    });
    const firstBranch = restaurant.branches[0];
    const currency = firstBranch
      ? ((await c.repos.access.findBranchRef(firstBranch.id))?.currency ?? "INR")
      : "INR";
    const data: AdminRestaurantMenuDto = {
      workspace: {
        id: ref.workspaceId,
        name: (await c.repos.access.findWorkspaceName(ref.workspaceId)) ?? "",
      },
      restaurant: { id: restaurant.id, name: restaurant.name, status: restaurant.status },
      branches: restaurant.branches,
      currency,
      menu,
      overrides,
    };
    return { data };
  },
);
