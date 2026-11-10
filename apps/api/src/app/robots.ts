import type { MetadataRoute } from "next";

/** The API serves no pages for search engines. Every response also carries X-Robots-Tag: noindex. */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
