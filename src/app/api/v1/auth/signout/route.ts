import { createAuthService } from "@/server/auth/auth-service";
import { readCookie, SESSION_COOKIE } from "@/server/http/cookies";
import { route } from "@/server/http/route";
import { clearSessionCookieHeader } from "@/server/http/session-cookie";

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
