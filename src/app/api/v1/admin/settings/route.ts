import { platformSettingsSchema } from "@/contracts/platform";
import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

export const GET = route({ auth: "platform" }, async ({ actor, c }) => ({
  data: await platformService(c).getSettings(actor),
}));

export const PUT = route(
  { auth: "platform", body: platformSettingsSchema },
  async ({ actor, body, meta, c }) => ({
    data: await platformService(c).updateSettings(actor, body, meta),
  }),
);
