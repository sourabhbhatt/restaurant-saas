import { signInSchema } from "@ros/contracts/auth";
import { createAuthService } from "@ros/application/auth/auth-service";
import { route } from "@ros/application/http/route";
import { sessionCookieHeader } from "@ros/application/http/session-cookie";

export const POST = route(
  {
    auth: "public",
    body: signInSchema,
    // Per client IP; a restaurant's staff share one, so this is wider than the per-account limit.
    rateLimit: { name: "signin", limit: 30, windowMs: 15 * 60_000 },
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
