import { z } from "zod";

import { menuService } from "@/composition/menu";
import { route } from "@ros/application/http/route";

const params = z.object({ branchId: z.uuid() });

/** Raw branch overrides (null = inherit), for the menu editor. */
export const GET = route({ auth: "user", params }, async ({ actor, params, c }) => {
  const scope = await c.access.forBranch(actor, params.branchId);
  return { data: await menuService(c).listOverrides(scope) };
});
