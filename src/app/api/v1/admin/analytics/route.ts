import { z } from "zod";

import { analyticsService } from "@/server/composition/analytics";
import { route } from "@/server/http/route";

/**
 * Platform-wide aggregates for the Super Admin overview (counts only, no
 * tenant records). `params` is optional because Next may hand static routes
 * an undefined params object.
 */
export const GET = route({ auth: "platform", params: z.object({}).optional() }, async ({ c }) => {
  return { data: await analyticsService(c).platform() };
});
