import { platformSettingsSchema } from "@ros/contracts/platform";
import { platformService } from "@/composition/platform";
import { forgetMaintenanceFlag, route } from "@ros/application/http/route";

export const GET = route({ auth: "platform" }, async ({ actor, c }) => ({
  data: await platformService(c).getSettings(actor),
}));

export const PUT = route(
  { auth: "platform", body: platformSettingsSchema },
  async ({ actor, body, meta, c }) => {
    const data = await platformService(c).updateSettings(actor, body, meta);
    forgetMaintenanceFlag(c);
    return { data };
  },
);
