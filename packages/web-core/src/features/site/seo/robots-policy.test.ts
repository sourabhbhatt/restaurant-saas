import { describe, expect, it } from "vitest";

import {
  CONSOLE_DISALLOW,
  consoleRobots,
  consoleRobotsHeader,
  consoleSitemap,
  DISALLOW_ALL,
  isProductionHostRequest,
  NOINDEX,
} from "./robots-policy";
import { resolveSiteConfig } from "./site-config";
import { SITE_PAGES } from "./site-pages";

const PROD = resolveSiteConfig({
  SITE_INDEXABLE: "true",
  PUBLIC_SITE_URL: "https://www.restaurantos.in",
});
const LOCAL = resolveSiteConfig({ CONSOLE_URL: "http://localhost:3130" });
const STAGING = resolveSiteConfig({
  CONSOLE_URL: "https://ros-console-staging-367556472616.asia-south1.run.app",
});
/** Production variables copied onto a staging service by mistake. */
const PROD_ENV_ON_STAGING_HOST = "ros-console-staging-367556472616.asia-south1.run.app";

const rules = (robots: ReturnType<typeof consoleRobots>) =>
  Array.isArray(robots.rules) ? robots.rules : [robots.rules];

describe("console robots.txt", () => {
  it("disallows private areas, guest QR pages, the API and token links in every environment", () => {
    for (const config of [PROD, LOCAL, STAGING]) {
      const [rule] = rules(consoleRobots(config));
      expect(rule?.userAgent).toBe("*");
      expect(rule?.allow).toBe("/");
      for (const path of ["/app", "/t/", "/print", "/api/", "/dev", "/design-system", "/invite/"]) {
        expect(rule?.disallow).toContain(path);
      }
    }
  });

  it("keeps public pages, sign-in and build assets crawlable", () => {
    // noindex is only visible to a crawler that may fetch the page; JS/CSS are needed to render.
    const blocked = (path: string) => CONSOLE_DISALLOW.some((prefix) => path.startsWith(prefix));
    for (const page of SITE_PAGES) expect(blocked(page.path)).toBe(false);
    expect(blocked("/sign-in")).toBe(false);
    expect(blocked("/sign-up")).toBe(false);
    expect(blocked("/_next/static/chunks/app.js")).toBe(false);
  });

  it("advertises the sitemap only on the production site", () => {
    expect(consoleRobots(PROD).sitemap).toBe("https://www.restaurantos.in/sitemap.xml");
    expect(consoleRobots(LOCAL).sitemap).toBeUndefined();
    expect(consoleRobots(STAGING).sitemap).toBeUndefined();
  });

  it("ops, admin and the API disallow everything", () => {
    expect(DISALLOW_ALL.rules).toEqual([{ userAgent: "*", disallow: "/" }]);
  });
});

describe("console sitemap", () => {
  it("is empty outside production", () => {
    expect(consoleSitemap(LOCAL)).toEqual([]);
    expect(consoleSitemap(STAGING)).toEqual([]);
  });

  it("lists every public page once, as absolute https URLs on the production origin", () => {
    const urls = consoleSitemap(PROD).map((entry) => entry.url);
    expect(urls).toHaveLength(SITE_PAGES.length);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls[0]).toBe("https://www.restaurantos.in/");
    for (const url of urls) expect(url.startsWith("https://www.restaurantos.in/")).toBe(true);
    expect(urls).toContain("https://www.restaurantos.in/features/qr-code-ordering");
  });

  it("never lists private routes", () => {
    const paths = consoleSitemap(PROD).map((entry) => new URL(entry.url).pathname);
    for (const path of paths) {
      expect(CONSOLE_DISALLOW.some((prefix) => path.startsWith(prefix))).toBe(false);
      expect(path).not.toMatch(/sign-in|sign-up|^\/t\/|^\/app/);
    }
  });
});

describe("X-Robots-Tag decision", () => {
  const prodHost = { host: "www.restaurantos.in" };

  it("allows indexing of public pages on the production host only", () => {
    for (const page of SITE_PAGES) {
      expect(consoleRobotsHeader(PROD, { pathname: page.path, ...prodHost })).toBeNull();
    }
    expect(consoleRobotsHeader(PROD, { pathname: "/pricing/", ...prodHost })).toBeNull();
    expect(
      consoleRobotsHeader(PROD, { pathname: "/pricing", host: "www.restaurantos.in:443" }),
    ).toBeNull();
  });

  it.each([
    "/app",
    "/app/w/123",
    "/t/some-table-token",
    "/print/tables",
    "/sign-in",
    "/sign-up",
    "/reset-password",
    "/invite/abc",
    "/design-system",
    "/dev/mailbox",
    "/~offline",
    "/does-not-exist",
    "/llms.txt",
  ])("marks %s noindex even in production", (pathname) => {
    expect(consoleRobotsHeader(PROD, { pathname, ...prodHost })).toBe(NOINDEX);
  });

  it("marks everything noindex locally and on staging", () => {
    for (const config of [LOCAL, STAGING]) {
      for (const pathname of ["/", "/pricing", "/features"]) {
        expect(consoleRobotsHeader(config, { pathname, host: config.host })).toBe(NOINDEX);
      }
    }
  });

  it("keeps staging noindex even when production variables are copied to it", () => {
    expect(consoleRobotsHeader(PROD, { pathname: "/", host: PROD_ENV_ON_STAGING_HOST })).toBe(
      NOINDEX,
    );
    expect(consoleRobotsHeader(PROD, { pathname: "/", host: "localhost:3130" })).toBe(NOINDEX);
    expect(consoleRobotsHeader(PROD, { pathname: "/", host: null })).toBe(NOINDEX);
  });

  it("lets the Organization logo and share image be indexed on the production host only", () => {
    // Google: the Organization logo URL "must be crawlable and indexable".
    for (const pathname of ["/logo.png", "/og-image.png"]) {
      expect(consoleRobotsHeader(PROD, { pathname, ...prodHost })).toBeNull();
      expect(consoleRobotsHeader(PROD, { pathname, host: PROD_ENV_ON_STAGING_HOST })).toBe(NOINDEX);
      expect(consoleRobotsHeader(STAGING, { pathname, host: STAGING.host })).toBe(NOINDEX);
      expect(consoleRobotsHeader(LOCAL, { pathname, host: LOCAL.host })).toBe(NOINDEX);
    }
    expect(consoleRobotsHeader(PROD, { pathname: "/logo.png.bak", ...prodHost })).toBe(NOINDEX);
  });

  it("treats site images like public pages: indexable on the production host only", () => {
    const image = (url: string) => `?url=${encodeURIComponent(url)}&w=640&q=75`;
    expect(consoleRobotsHeader(PROD, { pathname: "/images/hero.png", ...prodHost })).toBeNull();
    expect(
      consoleRobotsHeader(PROD, {
        pathname: "/_next/image",
        search: image("/images/hero.png"),
        ...prodHost,
      }),
    ).toBeNull();
    expect(
      consoleRobotsHeader(PROD, {
        pathname: "/_next/image",
        search: image("/logo.png"),
        ...prodHost,
      }),
    ).toBeNull();
    // Optimised copies of anything else (guest menu photos, uploads, icons) stay out of search.
    for (const url of [
      "/api/v1/files/menu/abc.jpg",
      "/icons/icon-192.png",
      "/images/../api/v1/files/x.jpg",
      "//evil.example/images/x.png",
      "https://evil.example/images/x.png",
      // URL parsing turns "\" into "/": these resolve to another host.
      "/\\evil.example/images/x.png",
      "\\\\evil.example/images/x.png",
      "/\\/evil.example/images/x.png",
      "//[",
      "/\\[", // does not parse; must not throw in the proxy
    ]) {
      expect(
        consoleRobotsHeader(PROD, { pathname: "/_next/image", search: image(url), ...prodHost }),
      ).toBe(NOINDEX);
    }
    expect(consoleRobotsHeader(PROD, { pathname: "/_next/image", ...prodHost })).toBe(NOINDEX);
    for (const config of [LOCAL, STAGING]) {
      expect(consoleRobotsHeader(config, { pathname: "/images/hero.png", host: config.host })).toBe(
        NOINDEX,
      );
      expect(
        consoleRobotsHeader(config, {
          pathname: "/_next/image",
          search: image("/images/hero.png"),
          host: config.host,
        }),
      ).toBe(NOINDEX);
    }
  });

  it("accepts the production host from X-Forwarded-Host (proxy or CDN in front)", () => {
    expect(
      isProductionHostRequest(PROD, {
        host: "ros-console-abc.a.run.app",
        forwardedHost: "www.restaurantos.in, edge.internal",
      }),
    ).toBe(true);
    expect(isProductionHostRequest(LOCAL, { host: "localhost:3130" })).toBe(false);
  });
});
