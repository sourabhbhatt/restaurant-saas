import type { MetadataRoute } from "next";

import { DISALLOW_ALL } from "@ros/web-core/features/site/seo/robots-policy";

/** Super Admin: nothing to crawl. Every response also carries X-Robots-Tag: noindex. */
export default function robots(): MetadataRoute.Robots {
  return DISALLOW_ALL;
}
