import { z } from "zod";

import { menuService } from "@/server/composition/menu";
import { route } from "@/server/http/route";

const params = z.object({ restaurantId: z.uuid() });

/** Full management tree: categories → items → variants, add-on groups. `menu.view` */
export const GET = route({ auth: "user", params }, async ({ actor, params, c }) => {
  const scope = await c.access.forRestaurant(actor, params.restaurantId);
  return { data: await menuService(c).getTree(scope) };
});
