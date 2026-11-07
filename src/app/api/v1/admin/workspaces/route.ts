import { adminWorkspaceListQuerySchema } from "@ros/contracts/platform";
import { platformService } from "@/composition/platform";
import { route } from "@ros/application/http/route";

/** Super Admin: all workspaces with plan, computed phase and counts. */
export const GET = route(
  { auth: "platform", query: adminWorkspaceListQuerySchema },
  async ({ actor, query, c }) => ({
    data: await platformService(c).listWorkspaces(actor, query),
  }),
);
