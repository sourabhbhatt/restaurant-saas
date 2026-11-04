import type { MeResponse } from "@/contracts/auth";
import { route } from "@/server/http/route";

export const GET = route({ auth: "user" }, async ({ actor, c }) => {
  const workspaces = await c.repos.access.listUserWorkspaces(actor.userId);
  const active =
    workspaces.find((w) => w.workspaceId === actor.activeWorkspaceId) ?? workspaces[0] ?? null;
  const data: MeResponse = {
    user: {
      id: actor.userId,
      email: actor.email,
      name: actor.name,
      emailVerified: actor.emailVerified,
      isPlatformAdmin: actor.isPlatformAdmin,
    },
    activeWorkspaceId: active?.workspaceId ?? null,
    workspaces: workspaces.map((w) => ({
      id: w.workspaceId,
      name: w.name,
      slug: w.slug,
      status: w.status,
      roleKey: w.roleKey,
      roleName: w.roleName,
    })),
  };
  return { data };
});
