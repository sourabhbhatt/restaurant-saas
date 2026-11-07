import {
  deletePushSubscriptionSchema,
  pushSubscriptionSchema,
} from "@ros/contracts/notifications-api";
import { notificationService } from "@/server/composition/notifications";
import { route } from "@/server/http/route";

/** Register this browser's push subscription for the signed-in user. */
export const POST = route(
  {
    auth: "user",
    body: pushSubscriptionSchema,
    rateLimit: { name: "push_subscribe", limit: 20, windowMs: 60 * 60_000 },
  },
  async ({ actor, body, req, c }) => {
    const data = await notificationService(c).subscribePush(
      actor,
      body,
      req.headers.get("user-agent"),
    );
    return { status: 201, data };
  },
);

/** Remove one of the user's own push subscriptions (no-op for others' endpoints). */
export const DELETE = route(
  { auth: "user", body: deletePushSubscriptionSchema },
  async ({ actor, body, c }) => {
    return { data: await notificationService(c).unsubscribePush(actor, body.endpoint) };
  },
);
