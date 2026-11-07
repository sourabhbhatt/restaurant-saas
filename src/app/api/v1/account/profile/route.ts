import { updateProfileSchema } from "@ros/contracts/auth";
import { tenancyService } from "@/server/composition/tenancy";
import { route } from "@/server/http/route";

/** Update the signed-in user's own profile (name). */
export const PATCH = route(
  {
    auth: "user",
    body: updateProfileSchema,
    rateLimit: { name: "profile_update", limit: 30, windowMs: 15 * 60_000 },
  },
  async ({ actor, body, meta, c }) => {
    return { data: await tenancyService(c).updateProfile(actor, body, meta) };
  },
);
