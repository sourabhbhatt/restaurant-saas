import { z } from "zod";

import { menuService } from "@/server/composition/menu";
import { route } from "@/server/http/route";

const params = z.object({ branchId: z.uuid() });
const query = z.object({
  /** Staff see unavailable items (flagged) by default; `false` hides them. */
  includeUnavailable: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

/** Branch-effective menu (overrides applied) for staff ordering. `orders.view` */
export const GET = route({ auth: "user", params, query }, async ({ actor, params, query, c }) => {
  const scope = await c.access.forBranch(actor, params.branchId);
  return { data: await menuService(c).getBranchMenu(scope, query.includeUnavailable) };
});
