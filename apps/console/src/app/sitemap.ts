import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { consoleSitemap } from "@ros/web-core/features/site/seo/robots-policy";
import { getSiteConfig } from "@ros/web-core/features/site/seo/site-config";

/** Public pages only, and empty outside the production site. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  return consoleSitemap(getSiteConfig());
}
