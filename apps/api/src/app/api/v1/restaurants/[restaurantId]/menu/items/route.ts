import { z } from "zod";

import { createItemSchema } from "@ros/contracts/menu";
import { menuService } from "@/composition/menu";
import { route } from "@ros/application/http/route";

const params = z.object({ restaurantId: z.uuid() });

export const POST = route(
  { auth: "user", params, body: createItemSchema },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forRestaurant(actor, params.restaurantId);
    return { status: 201, data: await menuService(c).createItem(scope, body, meta) };
  },
);
