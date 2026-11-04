import { analyticsService } from "@/server/composition/analytics";
import { route } from "@/server/http/route";

/** Platform-wide aggregates for the Super Admin overview (counts only, no tenant records). */
export const GET = route({ auth: "platform" }, async ({ c }) => {
  return { data: await analyticsService(c).platform() };
});
