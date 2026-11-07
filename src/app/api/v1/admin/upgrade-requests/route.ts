import { upgradeListQuerySchema } from "@ros/contracts/upgrades";
import { platformService } from "@/server/composition/platform";
import { route } from "@/server/http/route";

/** All upgrade requests (pending first), with search, status filter and pagination. */
export const GET = route(
  { auth: "platform", query: upgradeListQuerySchema },
  async ({ actor, query, c }) => ({
    data: await platformService(c).listUpgradeRequests(actor, query),
  }),
);
