import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic redirect for signed-in areas when no session cookie is present.
 * This is UX only; real authentication and authorization happen in every
 * API handler on the server.
 */
export function proxy(request: NextRequest) {
  if (!request.cookies.has("ros_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = `?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*", "/waiter/:path*", "/kitchen/:path*", "/cashier/:path*"],
};
