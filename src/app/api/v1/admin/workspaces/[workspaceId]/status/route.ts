import { z } from "zod";

import { workspaceStatusSchema } from "@ros/contracts/platform";
import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

/** Activate / suspend / deactivate a workspace (reason required; audited). */
export const POST = route(
  { auth: "platform", params: z.object({ workspaceId: z.uuid() }), body: workspaceStatusSchema },
  async ({ actor, params, body, meta, c }) => {
    await platformService(c).setWorkspaceStatus(actor, params.workspaceId, body, meta);
    return { data: { ok: true } };
  },
);
