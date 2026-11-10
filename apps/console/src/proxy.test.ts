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

  it("runs on pages but not on build assets, the API proxy or the service worker", () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const path of ["/", "/pricing", "/t/abc", "/app/w/1", "/robots.txt", "/sitemap.xml"]) {
      expect(matcher.test(path)).toBe(true);
    }
    for (const path of ["/_next/static/chunk.js", "/api/v1/health", "/serwist/sw.js"]) {
      expect(matcher.test(path)).toBe(false);
    }
  });
});
