import { connection } from "next/server";

import { loadPublicPlans } from "@ros/web-core/features/site/pricing/server-plans";
import { buildLlmsTxt } from "@ros/web-core/features/site/seo/llms-txt";
import { getSiteConfig } from "@ros/web-core/features/site/seo/site-config";

/** Markdown summary for AI agents (llmstxt.org). Not a search ranking factor. */
export async function GET() {
  // Absolute links use the runtime PUBLIC_SITE_URL; prices come from the API
  // (cached for a minute, null when it is unavailable).
  await connection();
  const plans = await loadPublicPlans();
  return new Response(buildLlmsTxt(getSiteConfig(), plans?.data ?? null), {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
