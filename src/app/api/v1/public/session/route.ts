import { orderingService } from "@/server/composition/ordering";
import { readGuestToken } from "@/server/modules/ordering/http/guest-cookie";
import { route } from "@/server/http/route";

/** GET /api/v1/public/session — the guest's session, own orders and issued bill. */
export const GET = route({ auth: "public" }, async ({ req, c }) => ({
  data: await orderingService(c).getGuestSession(readGuestToken(req)),
}));
