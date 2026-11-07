import { verifyEmailSchema } from "@ros/contracts/auth";
import { createAuthService } from "@ros/application/auth/auth-service";
import { route } from "@ros/application/http/route";

export const POST = route(
  {
    auth: "public",
    body: verifyEmailSchema,
    rateLimit: { name: "verify", limit: 20, windowMs: 15 * 60_000 },
  },
  async ({ body, meta, c }) => {
    await createAuthService(c).verifyEmail(body.token, meta);
    return { data: { ok: true } };
  },
);
