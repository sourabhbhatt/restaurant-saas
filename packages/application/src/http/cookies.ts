export const SESSION_COOKIE = "ros_session";
export const GUEST_COOKIE = "ros_guest";

export function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export interface CookieOptions {
  maxAgeSeconds: number;
  secure: boolean;
  path?: string;
}

/** httpOnly, SameSite=Lax cookie. Lax blocks cross-site POSTs carrying the cookie. */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Path=${options.path ?? "/"}`,
    `Max-Age=${Math.max(0, Math.floor(options.maxAgeSeconds))}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(name: string, secure: boolean): string {
  return serializeCookie(name, "", { maxAgeSeconds: 0, secure });
}
