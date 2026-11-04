import { changePasswordSchema } from "@/contracts/auth";
import { createAuthService } from "@/server/auth/auth-service";
import { route } from "@/server/http/route";

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
