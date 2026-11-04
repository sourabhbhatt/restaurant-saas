import { notificationService } from "@/server/composition/notifications";
import { route } from "@/server/http/route";

/** Whether browser push is configured. With the default noop provider: `{ enabled: false }`. */
export const GET = route({ auth: "user" }, async ({ c }) => {
  return { data: notificationService(c).pushConfig() };
});
