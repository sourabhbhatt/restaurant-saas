import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { config, proxy } from "./proxy";

function request(path: string, host: string, cookie?: string) {
  const headers = new Headers({ host });
  if (cookie) headers.set("cookie", cookie);
  return new NextRequest(new URL(path, `http://${host}`), { headers });
}

function setProduction() {
  vi.stubEnv("SITE_INDEXABLE", "true");
  vi.stubEnv("PUBLIC_SITE_URL", "https://www.restaurantos.in");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("console proxy: X-Robots-Tag", () => {
  it("marks every page noindex by default (local, CI, staging)", () => {
    vi.stubEnv("SITE_INDEXABLE", "");
    for (const path of ["/", "/pricing", "/features/qr-code-ordering", "/t/token", "/sign-in"]) {
      const res = proxy(request(path, "localhost:3130"));
      expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    }
  });

  it("lets public pages be indexed on the production host only", () => {
    setProduction();
    expect(proxy(request("/", "www.restaurantos.in")).headers.get("x-robots-tag")).toBeNull();
    expect(
      proxy(request("/features/kitchen-display-system", "www.restaurantos.in")).headers.get(
        "x-robots-tag",
      ),
    ).toBeNull();
    // The same image and variables served from a Cloud Run URL stay out of search.
    expect(
      proxy(request("/", "ros-console-staging-367556472616.asia-south1.run.app")).headers.get(
        "x-robots-tag",
      ),
    ).toBe("noindex, nofollow");
  });

  it("keeps guest QR pages, auth pages and unknown URLs noindex in production", () => {
    setProduction();
    for (const path of ["/t/abc", "/sign-in", "/print/tables", "/nope"]) {
      expect(proxy(request(path, "www.restaurantos.in")).headers.get("x-robots-tag")).toBe(
        "noindex, nofollow",
      );
    }
  });

  it("still redirects signed-out visitors away from /app, with noindex", () => {
    setProduction();
    const res = proxy(request("/app/w/1", "www.restaurantos.in"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/sign-in?next=%2Fapp%2Fw%2F1");
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");

    const signedIn = proxy(request("/app", "www.restaurantos.in", "ros_session=x"));
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("lets the logo, share image and site images be indexed on the production host only", () => {
    setProduction();
    for (const path of [
      "/logo.png",
      "/og-image.png",
      "/_next/image?url=%2Fimages%2Fa.png&w=64&q=75",
    ]) {
      expect(proxy(request(path, "www.restaurantos.in")).headers.get("x-robots-tag")).toBeNull();
      expect(
        proxy(request(path, "ros-console-staging-367556472616.asia-south1.run.app")).headers.get(
          "x-robots-tag",
        ),
      ).toBe("noindex, nofollow");
    }
    expect(
      proxy(
        request("/_next/image?url=%2Fapi%2Fv1%2Ffiles%2Fmenu.jpg&w=64&q=75", "www.restaurantos.in"),
      ).headers.get("x-robots-tag"),
    ).toBe("noindex, nofollow");
  });
});

describe("console proxy: matcher (Next.js's own matching)", () => {
  const matches = (url: string) =>
    unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: `http://localhost:3130${url}` });

  it.each([
    "/",
    "/pricing",
    "/features/qr-code-ordering",
    "/t/abc",
    "/app",
    "/app/w/1",
    "/robots.txt",
    "/sitemap.xml",
    "/llms.txt",
    "/logo.png",
    "/og-image.png",
    "/health",
    "/api",
    "/_next/image?url=%2Fimages%2Fa.png&w=64&q=75",
    "/images/hero.png",
  ])("runs on %s", (url) => expect(matches(url)).toBe(true));

  it.each([
    "/_next/static/chunks/app.js",
    "/api/v1/health",
    "/api/v1/public/plans",
    "/serwist/sw.js",
    "/icons/icon-192.png",
    "/favicon.ico",
  ])("skips %s", (url) => expect(matches(url)).toBe(false));
});
