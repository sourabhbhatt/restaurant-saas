import { createAuthService } from "@ros/application/auth/auth-service";
import { readCookie, SESSION_COOKIE } from "@ros/application/http/cookies";
import { route } from "@ros/application/http/route";
import { clearSessionCookieHeader } from "@ros/application/http/session-cookie";

export const POST = route(
  { auth: "optional", allowInMaintenance: true },
  async ({ req, actor, meta, c }) => {
    await createAuthService(c).signOut(
      readCookie(req.headers.get("cookie"), SESSION_COOKIE),
      actor,
      meta,
    );
    return { data: { ok: true }, headers: clearSessionCookieHeader(c) };
  },
);
