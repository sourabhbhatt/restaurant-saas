import { z } from "zod";

import { assignBranchStaffSchema } from "@ros/contracts/tenancy";
import { tenancyService } from "@/server/composition/tenancy";
import { route } from "@/server/http/route";

const params = z.object({ branchId: z.uuid() });

/** Role assignments covering this branch, assignable members and roles. */
export const GET = route({ auth: "user", params }, async ({ actor, params, c }) => {
  const scope = await c.access.forBranch(actor, params.branchId);
  return { data: await tenancyService(c).listBranchStaff(scope) };
});

export const POST = route(
  { auth: "user", params, body: assignBranchStaffSchema },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    return { status: 201, data: await tenancyService(c).assignBranchStaff(scope, body, meta) };
  },
);

/** DELETE ?assignmentId=… (also available as DELETE /branches/:id/staff/:assignmentId). */
export const DELETE = route(
  { auth: "user", params, query: z.object({ assignmentId: z.uuid() }) },
  async ({ actor, params, query, meta, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    await tenancyService(c).removeBranchStaff(scope, query.assignmentId, meta);
    return { data: { ok: true } };
  },
);
