import type { MetadataRoute } from "next";

import { absoluteUrl, type SiteConfig } from "./site-config";
import { isPublicSitePath, SITE_PAGES } from "./site-pages";

/** Value of the X-Robots-Tag header on everything that must stay out of search. */
export const NOINDEX = "noindex, nofollow";

/**
 * Console paths crawlers are asked not to fetch: signed-in areas, guest QR
 * pages (`/t/<token>` carries a table token), print sheets, the API proxy,
 * developer pages and token-bearing auth links. `/sign-in` and `/sign-up`
 * stay crawlable on purpose: they are linked from every public page and
 * carry `noindex`, which a crawler can only see if it may fetch the page.
 */
export const CONSOLE_DISALLOW = [
  "/app",
  "/t/",
  "/print",
  "/api/",
  "/dev",
  "/design-system",
  "/invite/",
  "/reset-password",
  "/verify-email",
  "/~offline",
  "/serwist/",
  "/health",
];

/**
 * robots.txt for the console. Outside production the same rules apply but no
 * sitemap is advertised: public pages stay crawlable so crawlers can read the
 * `noindex` on them (a page blocked in robots.txt can still be indexed from
 * links, without its content).
 */
export function consoleRobots(config: SiteConfig): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: CONSOLE_DISALLOW }],
    ...(config.indexable ? { sitemap: absoluteUrl(config, "/sitemap.xml") } : {}),
  };
}

/** robots.txt for ops, admin and the API: nothing there is meant for search. */
export const DISALLOW_ALL: MetadataRoute.Robots = {
  rules: [{ userAgent: "*", disallow: "/" }],
};

/** The sitemap lists public pages only, and only on the production site. */
export function consoleSitemap(config: SiteConfig): MetadataRoute.Sitemap {
  if (!config.indexable) return [];
  return SITE_PAGES.map((page) => ({ url: absoluteUrl(config, page.path) }));
}

function normaliseHost(value: string | null | undefined): string | null {
  const first = value?.split(",")[0]?.trim().toLowerCase();
  if (!first) return null;
  return first.replace(/:(80|443)$/, "");
}

export interface RobotsRequest {
  pathname: string;
  host?: string | null;
  forwardedHost?: string | null;
}

/** True when the request reached the production site on its own host (not *.run.app, staging …). */
export function isProductionHostRequest(
  config: SiteConfig,
  request: Pick<RobotsRequest, "host" | "forwardedHost">,
): boolean {
  if (!config.indexable) return false;
  const hosts = [normaliseHost(request.forwardedHost), normaliseHost(request.host)];
  return hosts.includes(normaliseHost(config.host));
}

/**
 * X-Robots-Tag for a console response, or null when the page may be indexed.
 * A page is indexable only on the production site, on its own host (so the
 * same configuration served from a *.run.app URL or a staging host is still
 * noindex) and only when it is one of the public pages.
 */
export function consoleRobotsHeader(config: SiteConfig, request: RobotsRequest): string | null {
  if (!isProductionHostRequest(config, request)) return NOINDEX;
  return isPublicSitePath(request.pathname) ? null : NOINDEX;
}
