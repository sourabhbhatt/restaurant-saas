import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

/** Active announcements within their time window (shown in every signed-in shell). */
export const GET = route({ auth: "public" }, async ({ c }) => {
  return { data: await platformService(c).listActiveAnnouncements() };
});
