import { changePasswordSchema } from "@ros/contracts/auth";
import { createAuthService } from "@ros/application/auth/auth-service";
import { route } from "@ros/application/http/route";

export const PUT = route(
  {
    auth: "user",
    body: changePasswordSchema,
    rateLimit: { name: "password", limit: 10, windowMs: 15 * 60_000 },
  },
  async ({ body, actor, meta, c }) => {
    await createAuthService(c).changePassword(actor, body.currentPassword, body.newPassword, meta);
    return { data: { ok: true } };
  },
);
