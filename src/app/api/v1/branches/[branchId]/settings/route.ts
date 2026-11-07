import { z } from "zod";

import { branchSettingsSchema } from "@ros/contracts/tenancy";
import { tenancyService } from "@/server/composition/tenancy";
import { route } from "@/server/http/route";

const params = z.object({ branchId: z.uuid() });

export const GET = route({ auth: "user", params }, async ({ actor, params, c }) => {
  const scope = await c.access.forBranch(actor, params.branchId);
  return { data: await tenancyService(c).getBranchSettings(scope) };
});

export const PUT = route(
  { auth: "user", params, body: branchSettingsSchema },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    return { data: await tenancyService(c).updateBranchSettings(scope, body, meta) };
  },
);
