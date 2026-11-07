import { z } from "zod";

import { tenancyService } from "@/composition/tenancy";
import { route } from "@ros/application/http/route";

export const DELETE = route(
  { auth: "user", params: z.object({ branchId: z.uuid(), assignmentId: z.uuid() }) },
  async ({ actor, params, meta, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    await tenancyService(c).removeBranchStaff(scope, params.assignmentId, meta);
    return { data: { ok: true } };
  },
);
