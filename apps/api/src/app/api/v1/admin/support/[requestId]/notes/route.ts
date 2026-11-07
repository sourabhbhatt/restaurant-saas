import { z } from "zod";

import { supportNoteSchema } from "@ros/contracts/platform";
import { platformService } from "@/composition/platform";
import { route } from "@ros/application/http/route";

/** Internal note on a support request (visible to Super Admins only). */
export const POST = route(
  { auth: "platform", params: z.object({ requestId: z.uuid() }), body: supportNoteSchema },
  async ({ actor, params, body, meta, c }) => ({
    status: 201,
    data: await platformService(c).addSupportNote(actor, params.requestId, body.body, meta),
  }),
);
