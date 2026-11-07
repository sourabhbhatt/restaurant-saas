import { z } from "zod";

import { availabilitySchema } from "@ros/contracts/menu";
import { menuService } from "@/server/composition/menu";
import { route } from "@/server/http/route";

const params = z.object({ itemId: z.uuid() });

export const PATCH = route(
  { auth: "user", params, body: availabilitySchema },
  async ({ actor, params, body, meta, c }) => {
    const svc = menuService(c);
    const scope = await svc.scopeForItem(actor, params.itemId);
    return { data: await svc.setAvailability(scope, params.itemId, body.isAvailable, meta) };
  },
);
