import { adminWorkspaceListQuerySchema } from "@ros/contracts/platform";
import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

/** Super Admin: all workspaces with plan, computed phase and counts. */
export const GET = route(
  { auth: "platform", query: adminWorkspaceListQuerySchema },
  async ({ actor, query, c }) => ({
    data: await platformService(c).listWorkspaces(actor, query),
  }),
);
