import { z } from "zod";

import { announcementInputSchema } from "@ros/contracts/platform";
import { platformService } from "@/composition/platform";
import { route } from "@ros/application/http/route";

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
