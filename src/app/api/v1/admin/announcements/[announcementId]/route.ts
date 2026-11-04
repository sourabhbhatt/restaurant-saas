import { z } from "zod";

import { announcementInputSchema } from "@/contracts/platform";
import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

const params = z.object({ announcementId: z.uuid() });

export const PATCH = route(
  { auth: "platform", params, body: announcementInputSchema },
  async ({ actor, params, body, meta, c }) => ({
    data: await platformService(c).updateAnnouncement(actor, params.announcementId, body, meta),
  }),
);

export const DELETE = route({ auth: "platform", params }, async ({ actor, params, meta, c }) => {
  await platformService(c).deleteAnnouncement(actor, params.announcementId, meta);
  return { data: { ok: true } };
});
