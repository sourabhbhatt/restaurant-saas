import { cookieSecure } from "../../../config/env";
import type { Container } from "../../../container";
import { GUEST_COOKIE, readCookie, serializeCookie } from "../../../http/cookies";
import { GUEST_SESSION_HOURS } from "../service";

/** The guest token from the request's `ros_guest` cookie (opaque; hashed before lookup). */
export function readGuestToken(req: Request): string | null {
  return readCookie(req.headers.get("cookie"), GUEST_COOKIE);
}

/** httpOnly, SameSite=Lax, path "/", 12 h. Bound to exactly one table session. */
export function guestCookieHeader(c: Container, token: string): Record<string, string> {
  return {
    "set-cookie": serializeCookie(GUEST_COOKIE, token, {
      maxAgeSeconds: GUEST_SESSION_HOURS * 60 * 60,
      secure: cookieSecure(c.env),
      path: "/",
    }),
  };
}
