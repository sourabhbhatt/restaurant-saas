import { z } from "zod";

import { orderingService } from "@/server/composition/ordering";
import { route } from "@/server/http/route";

/** GET /api/v1/public/qr/:token — branding, table and the available branch menu. */
export const GET = route(
  {
    auth: "public",
    params: z.object({ token: z.string().max(200) }),
    rateLimit: { name: "public-qr", limit: 60, windowMs: 60_000 },
  },
  async ({ params, c }) => ({ data: await orderingService(c).resolveQr(params.token) }),
);
