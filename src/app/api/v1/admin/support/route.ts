import { supportListQuerySchema } from "@/contracts/platform";
import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

export const GET = route(
  { auth: "platform", query: supportListQuerySchema },
  async ({ actor, query, c }) => ({
    data: await platformService(c).listSupport(actor, query),
  }),
);
