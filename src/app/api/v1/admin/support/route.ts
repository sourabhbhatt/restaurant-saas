import { supportListQuerySchema } from "@ros/contracts/platform";
import { platformService } from "@/composition/platform";
import { route } from "@ros/application/http/route";

export const GET = route(
  { auth: "platform", query: supportListQuerySchema },
  async ({ actor, query, c }) => ({
    data: await platformService(c).listSupport(actor, query),
  }),
);
