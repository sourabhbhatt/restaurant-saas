import { notificationService } from "@/composition/notifications";
import { route } from "@ros/application/http/route";

/** Whether browser push is configured. With the default noop provider: `{ enabled: false }`. */
export const GET = route({ auth: "user" }, async ({ c }) => {
  return { data: notificationService(c).pushConfig() };
});
