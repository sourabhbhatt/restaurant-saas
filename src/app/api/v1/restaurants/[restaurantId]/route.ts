import { z } from "zod";

import { updateRestaurantSchema } from "@ros/contracts/tenancy";
import { tenancyService } from "@/composition/tenancy";
import { route } from "@ros/application/http/route";

const params = z.object({ restaurantId: z.uuid() });

export const GET = route({ auth: "user", params }, async ({ actor, params, c }) => {
  const scope = await c.access.forRestaurant(actor, params.restaurantId);
  return { data: await tenancyService(c).getRestaurant(scope) };
});

export const PATCH = route(
  { auth: "user", params, body: updateRestaurantSchema },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forRestaurant(actor, params.restaurantId);
    return { data: await tenancyService(c).updateRestaurant(scope, body, meta) };
  },
);

/** Archive (soft delete) the restaurant and its branches. */
export const DELETE = route({ auth: "user", params }, async ({ actor, params, meta, c }) => {
  const scope = await c.access.forRestaurant(actor, params.restaurantId);
  await tenancyService(c).archiveRestaurant(scope, meta);
  return { data: { ok: true } };
});
