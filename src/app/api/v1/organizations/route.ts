import { workspaceService } from "@/composition/workspaces";
import { route } from "@ros/application/http/route";

/** The caller's organizations and how many workspaces each may hold now. */
export const GET = route({ auth: "user" }, async ({ actor, c }) => ({
  data: await workspaceService(c).listOrganizations(actor),
}));
