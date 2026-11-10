import type { Metadata } from "next";
import { headers } from "next/headers";

import { BRAND } from "../brand";
import { isProductionHostRequest } from "./robots-policy";
import { absoluteUrl, getSiteConfig, type SiteConfig } from "./site-config";
import { fullTitle, getSitePage, type SitePage, type SitePath } from "./site-pages";

/** Shared Open Graph / Twitter image, rendered by app/og-image.png/route.tsx. */
export const OG_IMAGE = {
  path: "/og-image.png",
  width: 1200,
  height: 630,
  alt: `${BRAND.name}: QR table ordering, kitchen display and counter billing for restaurants`,
} as const;

export const NOINDEX_ROBOTS: Metadata["robots"] = { index: false, follow: false };

/**
 * Metadata for a public page. `indexable` is true only on the production site
 * reached on its own host; the canonical URL always names the production
 * origin, so a copy served elsewhere (a *.run.app URL) points to the real page.
 */
export function buildPageMetadata(
  page: SitePage,
  config: SiteConfig,
  indexable: boolean,
): Metadata {
  const url = absoluteUrl(config, page.path);
  const title = fullTitle(page);
  const image = { ...OG_IMAGE, url: absoluteUrl(config, OG_IMAGE.path) };
  return {
    title: page.absoluteTitle ? { absolute: page.title } : page.title,
    description: page.description,
    alternates: { canonical: url },
    robots: indexable
      ? {
          index: true,
          follow: true,
          googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
        }
      : NOINDEX_ROBOTS,
    openGraph: {
      type: "website",
      siteName: BRAND.name,
      locale: "en_IN",
      url,
      title,
      description: page.description,
      images: [{ url: image.url, width: image.width, height: image.height, alt: image.alt }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: page.description,
      images: [{ url: image.url, alt: image.alt }],
    },
  };
}

/**
 * `generateMetadata` for a public page. Canonical URLs and the robots policy
 * come from the runtime environment and the request's host, so it runs per
 * request (metadata is streamed to browsers and in the <head> for crawlers,
 * see seo/crawlers.ts).
 */
export async function publicPageMetadata(path: SitePath): Promise<Metadata> {
  const requestHeaders = await headers();
  const config = getSiteConfig();
  const indexable = isProductionHostRequest(config, {
    host: requestHeaders.get("host"),
    forwardedHost: requestHeaders.get("x-forwarded-host"),
  });
  return buildPageMetadata(getSitePage(path), config, indexable);
}
