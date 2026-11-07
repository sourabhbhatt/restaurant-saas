import { forgotPasswordSchema } from "@ros/contracts/auth";
import { createAuthService } from "@ros/application/auth/auth-service";
import { route } from "@ros/application/http/route";

export const POST = route(
  {
    auth: "public",
    body: forgotPasswordSchema,
    rateLimit: { name: "forgot", limit: 5, windowMs: 15 * 60_000 },
  },
  async ({ body, meta, c }) => {
    await createAuthService(c).requestPasswordReset(body.email, meta);
    return { data: { ok: true } };
  },
);
