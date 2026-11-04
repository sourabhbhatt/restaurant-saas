import { z } from "zod";

import { upgradeNoteSchema } from "@/contracts/upgrades";
import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

/** Add an internal note (not visible to the workspace). */
export const POST = route(
  { auth: "platform", params: z.object({ requestId: z.uuid() }), body: upgradeNoteSchema },
  async ({ actor, params, body, meta, c }) => {
    await platformService(c).addUpgradeNote(actor, params.requestId, body.body, meta);
    return { status: 201, data: { ok: true } };
  },
);
