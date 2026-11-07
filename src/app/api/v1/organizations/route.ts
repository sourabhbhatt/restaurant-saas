import { workspaceService } from "@/server/composition/workspaces";
import { route } from "@/server/http/route";

/** The caller's organizations and how many workspaces each may hold now. */
export const GET = route({ auth: "user" }, async ({ actor, c }) => ({
  data: await workspaceService(c).listOrganizations(actor),
}));
