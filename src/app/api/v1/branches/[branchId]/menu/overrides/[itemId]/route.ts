import { z } from "zod";

import { branchOverrideSchema } from "@ros/contracts/menu";
import { menuService } from "@/composition/menu";
import { route } from "@ros/application/http/route";

const params = z.object({ branchId: z.uuid(), itemId: z.uuid() });

/** `{ price?, discountedPrice?, isAvailable? }`: omitted = unchanged, null = inherit. */
export const PUT = route(
  { auth: "user", params, body: branchOverrideSchema },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    return { data: await menuService(c).putOverride(scope, params.itemId, body, meta) };
  },
);
