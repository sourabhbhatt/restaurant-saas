import { z } from "zod";

import { createRestaurantSchema } from "@/contracts/tenancy";
import { tenancyService } from "@/server/composition/tenancy";
import { route } from "@/server/http/route";

const params = z.object({ workspaceId: z.uuid() });

export const GET = route({ auth: "user", params }, async ({ actor, params, c }) => {
  const scope = await c.access.forWorkspace(actor, params.workspaceId);
  return { data: await tenancyService(c).listRestaurants(scope) };
});

export const POST = route(
  { auth: "user", params, body: createRestaurantSchema },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    return { status: 201, data: await tenancyService(c).createRestaurant(scope, body, meta) };
  },
);
