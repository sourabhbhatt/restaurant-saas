/**
 * Next.js's documented default `htmlLimitedBots` list (Next 16.4.5, from
 * `packages/next/src/shared/lib/router/utils/html-bots.ts`), copied so the
 * build does not depend on Next internals. Setting `htmlLimitedBots` replaces
 * the default, so it is kept here. A unit test compares this copy with the
 * installed Next.js and fails after an upgrade that changes it.
 */
export const NEXT_DEFAULT_HTML_LIMITED_BOTS =
  "[\\w-]+-Google|Google-[\\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight";

/**
 * Crawlers that must receive metadata in the initial `<head>`.
 *
 * Public pages resolve canonical URLs and the robots policy from the runtime
 * environment, so Next.js streams their metadata to ordinary browsers. Google
 * only accepts rel=canonical inside `<head>`, and AI crawlers do not run
 * JavaScript, so these user agents get a blocking render with the metadata in
 * the head instead.
 */
const SEARCH_AND_AI_CRAWLERS = [
  "Googlebot",
  "GoogleOther",
  "Google-InspectionTool",
  "OAI-SearchBot",
  "ChatGPT-User",
  "GPTBot",
  "PerplexityBot",
  "Perplexity-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "CCBot",
  "Amazonbot",
  "DuckAssistBot",
  "meta-externalagent",
];

export const HTML_LIMITED_BOTS = new RegExp(
  `${NEXT_DEFAULT_HTML_LIMITED_BOTS}|${SEARCH_AND_AI_CRAWLERS.join("|")}`,
  "i",
);
