import { listNotificationsQuerySchema } from "@/contracts/notifications-api";
import { notificationService } from "@/server/composition/notifications";
import { route } from "@/server/http/route";

/** The signed-in user's own notifications, newest first, with the unread count. */
export const GET = route(
  { auth: "user", query: listNotificationsQuerySchema },
  async ({ actor, query, c }) => {
    const scope = query.workspaceId ? await c.access.forWorkspace(actor, query.workspaceId) : null;
    const data = await notificationService(c).list(actor, scope, {
      unread: query.unread,
      limit: query.limit,
      cursor: query.cursor,
      type: query.type,
    });
    return { data };
  },
);
