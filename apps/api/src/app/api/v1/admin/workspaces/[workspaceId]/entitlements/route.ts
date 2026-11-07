import { z } from "zod";

import { deleteOverrideQuerySchema, entitlementOverrideSchema } from "@ros/contracts/platform";
import { platformService } from "@/composition/platform";
import { route } from "@ros/application/http/route";

const params = z.object({ workspaceId: z.uuid() });

/** Upsert a per-workspace override (limit key or `feature:<key>`). */
export const PUT = route(
  { auth: "platform", params, body: entitlementOverrideSchema },
  async ({ actor, params, body, meta, c }) => {
    await platformService(c).setOverride(actor, params.workspaceId, body, meta);
    return { data: { ok: true } };
  },
);

/** Remove an override: `DELETE ...?key=maxBranches`. */
export const DELETE = route(
  { auth: "platform", params, query: deleteOverrideQuerySchema },
  async ({ actor, params, query, meta, c }) => {
    await platformService(c).removeOverride(actor, params.workspaceId, query.key, meta);
    return { data: { ok: true } };
  },
);
