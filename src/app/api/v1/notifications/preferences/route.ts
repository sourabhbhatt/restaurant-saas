import { updateNotificationPreferencesSchema } from "@/contracts/notifications-api";
import { notificationService } from "@/server/composition/notifications";
import { route } from "@/server/http/route";

export const GET = route({ auth: "user" }, async ({ actor, c }) => {
  return { data: await notificationService(c).getPreferences(actor) };
});

/** Replace preferences for the listed types (others keep their current value). */
export const PUT = route(
  {
    auth: "user",
    body: updateNotificationPreferencesSchema,
    rateLimit: { name: "notification_prefs", limit: 60, windowMs: 60_000 },
  },
  async ({ actor, body, meta, c }) => {
    return {
      data: await notificationService(c).updatePreferences(actor, body.preferences, meta),
    };
  },
);
