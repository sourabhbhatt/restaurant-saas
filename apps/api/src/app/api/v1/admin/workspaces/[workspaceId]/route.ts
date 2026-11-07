import { z } from "zod";

import { platformService } from "@/composition/platform";
import { route } from "@ros/application/http/route";

export const GET = route(
  { auth: "platform", params: z.object({ workspaceId: z.uuid() }) },
  async ({ actor, params, c }) => ({
    data: await platformService(c).getWorkspace(actor, params.workspaceId),
  }),
);
