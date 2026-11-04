import { z } from "zod";

import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

export const GET = route(
  { auth: "platform", params: z.object({ workspaceId: z.uuid() }) },
  async ({ actor, params, c }) => ({
    data: await platformService(c).getWorkspace(actor, params.workspaceId),
  }),
);
