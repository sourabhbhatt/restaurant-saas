import { planInputSchema } from "@ros/contracts/platform";
import { platformService } from "@/composition/platform";
import { route } from "@ros/application/http/route";

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
