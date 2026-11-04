import { planInputSchema } from "@/contracts/platform";
import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

export const GET = route({ auth: "platform" }, async ({ actor, c }) => ({
  data: await platformService(c).listPlans(actor),
}));

export const POST = route(
  { auth: "platform", body: planInputSchema },
  async ({ actor, body, meta, c }) => ({
    status: 201,
    data: await platformService(c).createPlan(actor, body, meta),
  }),
);
