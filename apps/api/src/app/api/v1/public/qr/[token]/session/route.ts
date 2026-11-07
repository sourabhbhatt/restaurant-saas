import { z } from "zod";

import { orderingService } from "@/composition/ordering";
import {
  guestCookieHeader,
  readGuestToken,
} from "@ros/application/modules/ordering/http/guest-cookie";
import { route } from "@ros/application/http/route";

/** POST /api/v1/public/qr/:token/session — join or open the table session; sets `ros_guest`. */
export const POST = route(
  {
    auth: "public",
    params: z.object({ token: z.string().max(200) }),
    rateLimit: { name: "public-join", limit: 30, windowMs: 10 * 60_000 },
  },
  async ({ req, params, meta, c }) => {
    const { result, guestToken } = await orderingService(c).joinSession(
      params.token,
      readGuestToken(req),
      meta,
    );
    return {
      status: result.rejoined ? 200 : 201,
      data: result,
      headers: guestToken ? guestCookieHeader(c, guestToken) : undefined,
    };
  },
);
