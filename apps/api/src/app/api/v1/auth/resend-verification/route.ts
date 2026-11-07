import { createAuthService } from "@ros/application/auth/auth-service";
import { route } from "@ros/application/http/route";

export const POST = route({ auth: "user" }, async ({ actor, c }) => {
  await createAuthService(c).resendVerification(actor);
  return { data: { ok: true } };
});
