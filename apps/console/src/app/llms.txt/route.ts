import { connection } from "next/server";

import { buildLlmsTxt } from "@ros/web-core/features/site/seo/llms-txt";
import { getSiteConfig } from "@ros/web-core/features/site/seo/site-config";

/** Markdown summary for AI agents (llmstxt.org). Not a search ranking factor. */
export async function GET() {
  // Absolute links use the runtime PUBLIC_SITE_URL.
  await connection();
  return new Response(buildLlmsTxt(getSiteConfig()), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
