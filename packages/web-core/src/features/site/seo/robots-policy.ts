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
  /** Query string (`?url=…` decides for `/_next/image`). */
  search?: string | null;
  host?: string | null;
  forwardedHost?: string | null;
}

/**
 * Images that may appear in search on the production site, like the public
 * pages: the Organization logo (Google requires it to be indexable), the share
 * image, and anything in `public/images/`. App icons, guest menu photos and
 * uploads are not on this list.
 */
const INDEXABLE_IMAGE_PATHS = new Set(["/logo.png", "/og-image.png"]);
const isIndexableImagePath = (pathname: string) =>
  INDEXABLE_IMAGE_PATHS.has(pathname) || pathname.startsWith("/images/");

/** Stands in for the request's own origin when resolving `url=`. */
const OWN_ORIGIN = "http://own.invalid";

/** An optimised image (`/_next/image?url=…`) is indexable only if its source is. */
function isIndexableOptimisedImage(search: string | null | undefined): boolean {
  const source = new URLSearchParams(search ?? "").get("url");
  if (!source?.startsWith("/")) return false;
  // Only same-site images: "//host/…", "/\host/…" and absolute URLs resolve to
  // another origin.
  let resolved: URL;
  try {
    resolved = new URL(source, OWN_ORIGIN);
  } catch {
    return false; // "//[" and similar do not parse
  }
  return resolved.origin === OWN_ORIGIN && isIndexableImagePath(resolved.pathname);
}

function isIndexablePath(request: Pick<RobotsRequest, "pathname" | "search">): boolean {
  if (request.pathname === "/_next/image") return isIndexableOptimisedImage(request.search);
  return isPublicSitePath(request.pathname) || isIndexableImagePath(request.pathname);
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
 * X-Robots-Tag for a console response, or null when it may be indexed.
 * A response is indexable only on the production site, on its own host (so the
 * same configuration served from a *.run.app URL or a staging host is still
 * noindex) and only when it is a public page or a site image.
 */
export function consoleRobotsHeader(config: SiteConfig, request: RobotsRequest): string | null {
  if (!isProductionHostRequest(config, request)) return NOINDEX;
  return isIndexablePath(request) ? null : NOINDEX;
}
