import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { consoleRobots } from "@ros/web-core/features/site/seo/robots-policy";
import { getSiteConfig } from "@ros/web-core/features/site/seo/site-config";

export default async function robots(): Promise<MetadataRoute.Robots> {
  // The sitemap URL and the production check come from the runtime environment.
  await connection();
  return consoleRobots(getSiteConfig());
}
