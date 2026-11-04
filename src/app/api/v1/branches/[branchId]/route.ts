import { z } from "zod";

import { updateBranchSchema } from "@/contracts/tenancy";
import { tenancyService } from "@/server/composition/tenancy";
import { route } from "@/server/http/route";

const params = z.object({ branchId: z.uuid() });

export const GET = route({ auth: "user", params }, async ({ actor, params, c }) => {
  const scope = await c.access.forBranch(actor, params.branchId);
  return { data: await tenancyService(c).getBranch(scope) };
});

export const PATCH = route(
  { auth: "user", params, body: updateBranchSchema },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forBranch(actor, params.branchId);
    return { data: await tenancyService(c).updateBranch(scope, body, meta) };
  },
);

/** Archive (soft delete) the branch. */
export const DELETE = route({ auth: "user", params }, async ({ actor, params, meta, c }) => {
  const scope = await c.access.forBranch(actor, params.branchId);
  await tenancyService(c).archiveBranch(scope, meta);
  return { data: { ok: true } };
});
