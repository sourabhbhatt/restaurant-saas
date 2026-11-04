import { resetPasswordSchema } from "@/contracts/auth";
import { createAuthService } from "@/server/auth/auth-service";
import { route } from "@/server/http/route";

export const POST = route(
  {
    auth: "public",
    body: resetPasswordSchema,
    rateLimit: { name: "reset", limit: 10, windowMs: 15 * 60_000 },
  },
  async ({ body, meta, c }) => {
    await createAuthService(c).resetPassword(body.token, body.password, meta);
    return { data: { ok: true } };
  },
);
