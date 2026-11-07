import type { NextRequest } from "next/server";

import { redirectWithoutSession } from "@ros/web-core/session-proxy";

export function proxy(request: NextRequest) {
  return redirectWithoutSession(request);
}

export const config = {
  matcher: ["/admin/:path*"],
};
