import { createWorkspaceSchema } from "@/contracts/workspaces";
import { workspaceService } from "@/server/composition/workspaces";
import { route } from "@/server/http/route";

export const GET = route({ auth: "user" }, async ({ actor, c }) => {
  const list = await c.repos.access.listUserWorkspaces(actor.userId);
  return { data: list };
});

export const POST = route(
  {
    auth: "user",
    body: createWorkspaceSchema,
    rateLimit: { name: "workspace_create", limit: 10, windowMs: 60 * 60_000 },
  },
  async ({ actor, body, meta, c }) => {
    const ws = await workspaceService(c).create(actor, body, meta);
    await c.identity.setActiveWorkspace(actor.sessionId, ws.id);
    return { status: 201, data: ws };
  },
);
