import { NextResponse, type NextRequest } from "next/server";

import { withRobotsHeader } from "@ros/web-core/features/site/seo/robots-header";
import { redirectWithoutSession } from "@ros/web-core/session-proxy";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const response =
    pathname === "/app" || pathname.startsWith("/app/")
      ? redirectWithoutSession(request)
      : NextResponse.next();
  return withRobotsHeader(request, response);
}

export const config = {
  // Every page and image (for X-Robots-Tag); not build assets, the API proxy, the
  // service worker or app icons (those get a static noindex in next.config.ts).
  matcher: ["/((?!_next/static|api/|serwist/|icons/|favicon.ico).*)"],
};
