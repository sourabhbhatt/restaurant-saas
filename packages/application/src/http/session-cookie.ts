import { cookieSecure } from "../config/env";
import type { Container } from "../container";
import { clearCookie, serializeCookie, SESSION_COOKIE } from "./cookies";

export function sessionCookieHeader(
  c: Container,
  token: string,
  expiresAt: Date,
): Record<string, string> {
  return {
    "set-cookie": serializeCookie(SESSION_COOKIE, token, {
      maxAgeSeconds: (expiresAt.getTime() - Date.now()) / 1000,
      secure: cookieSecure(c.env),
    }),
  };
}

export function clearSessionCookieHeader(c: Container): Record<string, string> {
  return { "set-cookie": clearCookie(SESSION_COOKIE, cookieSecure(c.env)) };
}
