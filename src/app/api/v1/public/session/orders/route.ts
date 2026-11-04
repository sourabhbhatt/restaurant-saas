import { placeOrderSchema } from "@/contracts/orders";
import { orderingService } from "@/server/composition/ordering";
import { readGuestToken } from "@/server/modules/ordering/http/guest-cookie";
import { route } from "@/server/http/route";

/**
 * POST /api/v1/public/session/orders — place a guest order (PENDING until a
 * waiter accepts it). Idempotent via body.idempotencyKey: 201 new, 200 replay.
 * The per-IP limit here is generous (shared restaurant Wi-Fi); the service
 * adds a per-IP-and-session limit.
 */
export const POST = route(
  {
    auth: "public",
    body: placeOrderSchema,
    rateLimit: { name: "public-order", limit: 60, windowMs: 10 * 60_000 },
  },
  async ({ req, body, meta, c }) => {
    const { order, replay } = await orderingService(c).placeGuestOrder(
      readGuestToken(req),
      body,
      meta,
    );
    return { status: replay ? 200 : 201, data: order };
  },
);
