import { orderingService } from "@/composition/ordering";
import { readGuestToken } from "@ros/application/modules/ordering/http/guest-cookie";
import { route } from "@ros/application/http/route";

/** GET /api/v1/public/session — the guest's session, own orders and issued bill. */
export const GET = route({ auth: "public" }, async ({ req, c }) => ({
  data: await orderingService(c).getGuestSession(readGuestToken(req)),
}));
