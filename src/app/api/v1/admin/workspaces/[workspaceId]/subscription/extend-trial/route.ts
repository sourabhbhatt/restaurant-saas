import { z } from "zod";

import { extendTrialSchema } from "@ros/contracts/platform";
import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

/** Extend the trial by N days. */
export const POST = route(
  { auth: "platform", params: z.object({ workspaceId: z.uuid() }), body: extendTrialSchema },
  async ({ actor, params, body, meta, c }) => {
    await platformService(c).extendTrial(actor, params.workspaceId, body, meta);
    return { data: { ok: true } };
  },
);
