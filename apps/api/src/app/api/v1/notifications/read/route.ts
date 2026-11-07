import { markNotificationsReadSchema } from "@ros/contracts/notifications-api";
import { notificationService } from "@/composition/notifications";
import { route } from "@ros/application/http/route";

/** Mark the user's own notifications read (by id, or all). Naturally idempotent. */
export const POST = route(
  {
    auth: "user",
    body: markNotificationsReadSchema,
    rateLimit: { name: "notifications_read", limit: 120, windowMs: 60_000 },
  },
  async ({ actor, body, c }) => {
    const scope = body.workspaceId ? await c.access.forWorkspace(actor, body.workspaceId) : null;
    const data = await notificationService(c).markRead(actor, scope, {
      ids: body.ids,
      all: body.all,
    });
    return { data };
  },
);
