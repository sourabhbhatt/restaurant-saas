import { signInSchema } from "@ros/contracts/auth";
import { createAuthService } from "@/server/auth/auth-service";
import { route } from "@/server/http/route";
import { sessionCookieHeader } from "@/server/http/session-cookie";

export const POST = route(
  {
    auth: "public",
    body: signInSchema,
    rateLimit: { name: "signin", limit: 10, windowMs: 15 * 60_000 },
    allowInMaintenance: true,
  },
  async ({ body, meta, c }) => {
    const { user, session } = await createAuthService(c).signIn(body, meta);
    return {
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isPlatformAdmin: user.platformRole === "SUPER_ADMIN",
        },
      },
      headers: sessionCookieHeader(c, session.token, session.expiresAt),
    };
  },
);
