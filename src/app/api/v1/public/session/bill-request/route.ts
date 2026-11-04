import { orderingService } from "@/server/composition/ordering";
import { readGuestToken } from "@/server/modules/ordering/http/guest-cookie";
import { route } from "@/server/http/route";

/** POST /api/v1/public/session/bill-request — OPEN → BILL_REQUESTED; notifies staff. */
export const POST = route(
  {
    auth: "public",
    rateLimit: { name: "public-bill-request", limit: 20, windowMs: 10 * 60_000 },
  },
  async ({ req, meta, c }) => ({
    data: await orderingService(c).requestBill(readGuestToken(req), meta),
  }),
);
