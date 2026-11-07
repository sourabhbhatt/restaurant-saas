import { z } from "zod";

import { organizationLimitOverrideSchema } from "@ros/contracts/platform";
import { platformService } from "@/composition/platform";
import { route } from "@ros/application/http/route";

/** Set or clear the organization's workspace limit override (Super Admin). */
export const PATCH = route(
  {
    auth: "platform",
    params: z.object({ organizationId: z.uuid() }),
    body: organizationLimitOverrideSchema,
  },
  async ({ actor, params, body, meta, c }) => ({
    data: await platformService(c).setOrganizationLimitOverride(
      actor,
      params.organizationId,
      body,
      meta,
    ),
  }),
);
