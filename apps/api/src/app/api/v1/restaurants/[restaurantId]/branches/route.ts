import { z } from "zod";

import { createBranchSchema } from "@ros/contracts/tenancy";
import { tenancyService } from "@/composition/tenancy";
import { route } from "@ros/application/http/route";

const params = z.object({ restaurantId: z.uuid() });

export const GET = route({ auth: "user", params }, async ({ actor, params, c }) => {
  const scope = await c.access.forRestaurant(actor, params.restaurantId);
  return { data: await tenancyService(c).listBranches(scope) };
});

export const POST = route(
  { auth: "user", params, body: createBranchSchema },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forRestaurant(actor, params.restaurantId);
    return { status: 201, data: await tenancyService(c).createBranch(scope, body, meta) };
  },
);
