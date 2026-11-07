import { z } from "zod";

import { updateMemberSchema } from "@ros/contracts/tenancy";
import { tenancyService } from "@/composition/tenancy";
import { route } from "@ros/application/http/route";

const params = z.object({ workspaceId: z.uuid(), membershipId: z.uuid() });

/** Change workspace role and/or enable/disable the membership. */
export const PATCH = route(
  { auth: "user", params, body: updateMemberSchema },
  async ({ actor, params, body, meta, c }) => {
    const scope = await c.access.forWorkspace(actor, params.workspaceId);
    return {
      data: await tenancyService(c).updateMember(scope, params.membershipId, body, meta),
    };
  },
);

export const DELETE = route({ auth: "user", params }, async ({ actor, params, meta, c }) => {
  const scope = await c.access.forWorkspace(actor, params.workspaceId);
  await tenancyService(c).removeMember(scope, params.membershipId, meta);
  return { data: { ok: true } };
});
