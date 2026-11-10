import type { NextRequest } from "next/server";

import { consoleRobotsHeader } from "./robots-policy";
import { getSiteConfig } from "./site-config";

/**
 * Adds `X-Robots-Tag: noindex, nofollow` to a console response unless it is a
 * public page or site image on the production site. Runs in the proxy, so the decision uses
 * the runtime environment and the real Host header on every request,
 * including prerendered pages and 404s.
 */
export function withRobotsHeader(request: NextRequest, response: Response): Response {
  const value = consoleRobotsHeader(getSiteConfig(), {
    pathname: request.nextUrl.pathname,
    search: request.nextUrl.search,
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
  });
  if (value) response.headers.set("X-Robots-Tag", value);
  return response;
}
