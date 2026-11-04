import { signUpSchema } from "@/contracts/auth";
import { createAuthService } from "@/server/auth/auth-service";
import { route } from "@/server/http/route";
import { sessionCookieHeader } from "@/server/http/session-cookie";

export const POST = route(
  {
    auth: "public",
    body: signUpSchema,
    rateLimit: { name: "signup", limit: 10, windowMs: 60 * 60_000 },
  },
  async ({ body, meta, c }) => {
    const { user, session } = await createAuthService(c).signUp(body, meta);
    return {
      status: 201,
      data: { user: { id: user.id, email: user.email, name: user.name } },
      headers: sessionCookieHeader(c, session.token, session.expiresAt),
    };
  },
);
