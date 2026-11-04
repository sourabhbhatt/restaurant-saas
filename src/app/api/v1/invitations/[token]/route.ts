import { z } from "zod";

import { invitationTokenParam } from "@/contracts/tenancy";
import { tenancyService } from "@/server/composition/tenancy";
import { route } from "@/server/http/route";

/** Public preview of an invitation (no sign-in needed). */
export const GET = route(
  {
    auth: "public",
    params: z.object({ token: invitationTokenParam }),
    rateLimit: { name: "invitation_preview", limit: 60, windowMs: 15 * 60_000 },
  },
  async ({ params, c }) => {
    return { data: await tenancyService(c).previewInvitation(params.token) };
  },
);
