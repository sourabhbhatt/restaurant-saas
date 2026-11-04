import { createAuthService } from "@/server/auth/auth-service";
import { route } from "@/server/http/route";

export const POST = route({ auth: "user" }, async ({ actor, c }) => {
  await createAuthService(c).resendVerification(actor);
  return { data: { ok: true } };
});
