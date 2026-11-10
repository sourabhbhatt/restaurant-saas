import { describe, expect, it } from "vitest";

import { getFeatureDetail } from "../feature-details";
import { buildPageMetadata } from "./page-metadata";
import { resolveSiteConfig } from "./site-config";
import {
  breadcrumbTrail,
  fullTitle,
  getSitePage,
  isPublicSitePath,
  SITE_PAGES,
} from "./site-pages";

const PROD = resolveSiteConfig({
  SITE_INDEXABLE: "true",
  PUBLIC_SITE_URL: "https://www.restaurantos.in",
});
const LOCAL = resolveSiteConfig({});

describe("buildPageMetadata", () => {
  it("gives every public page an absolute canonical URL on the configured origin", () => {
    for (const page of SITE_PAGES) {
      const meta = buildPageMetadata(page, PROD, true);
      expect(meta.alternates?.canonical).toBe(`https://www.restaurantos.in${page.path}`);
      expect(meta.openGraph).toMatchObject({ url: `https://www.restaurantos.in${page.path}` });
    }
  });

  it("indexes only when the request is on the production site", () => {
    const page = getSitePage("/pricing");
    expect(buildPageMetadata(page, PROD, true).robots).toMatchObject({ index: true, follow: true });
    expect(buildPageMetadata(page, PROD, false).robots).toEqual({ index: false, follow: false });
    expect(buildPageMetadata(page, LOCAL, false).robots).toEqual({ index: false, follow: false });
  });

  it("adds Open Graph and Twitter cards with the shared absolute image", () => {
    const meta = buildPageMetadata(getSitePage("/features/kitchen-display-system"), PROD, true);
    expect(meta.openGraph).toMatchObject({
      type: "website",
      siteName: "RestaurantOS",
      locale: "en_IN",
      title: "Kitchen display system (KDS) for restaurants · RestaurantOS",
      images: [{ url: "https://www.restaurantos.in/og-image.png", width: 1200, height: 630 }],
    });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("uses an absolute title on the homepage and the template elsewhere", () => {
    expect(buildPageMetadata(getSitePage("/"), PROD, true).title).toEqual({
      absolute: "Restaurant management software with QR ordering · RestaurantOS",
    });
    expect(buildPageMetadata(getSitePage("/faq"), PROD, true).title).toBe(
      "FAQ: QR ordering, offline use and billing",
    );
  });
});

describe("public page list", () => {
  it("has unique titles and descriptions of a useful length", () => {
    const titles = SITE_PAGES.map(fullTitle);
    const descriptions = SITE_PAGES.map((p) => p.description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    for (const title of titles) expect(title.length).toBeLessThanOrEqual(65);
    for (const description of descriptions) {
      expect(description.length).toBeGreaterThanOrEqual(70);
      expect(description.length).toBeLessThanOrEqual(170);
    }
  });

  it("recognises public paths, with or without a trailing slash", () => {
    expect(isPublicSitePath("/")).toBe(true);
    expect(isPublicSitePath("/features/offline-mode/")).toBe(true);
    expect(isPublicSitePath("/app")).toBe(false);
    expect(isPublicSitePath("/features/unknown")).toBe(false);
  });

  it("builds breadcrumb trails through parent pages", () => {
    expect(breadcrumbTrail("/features/restaurant-billing").map((p) => p.path)).toEqual([
      "/",
      "/features",
      "/features/restaurant-billing",
    ]);
    expect(breadcrumbTrail("/legal/terms").map((p) => p.path)).toEqual(["/", "/legal/terms"]);
    expect(breadcrumbTrail("/").map((p) => p.path)).toEqual(["/"]);
  });

  it("has content for every feature detail page", () => {
    for (const page of SITE_PAGES.filter((p) => p.path.startsWith("/features/"))) {
      expect(getFeatureDetail(page.path).h1.length).toBeGreaterThan(10);
    }
  });
});
