import { HTML_LIMITED_BOT_UA_RE_STRING } from "next/dist/shared/lib/router/utils/is-bot";

/**
 * Crawlers that must receive metadata in the initial `<head>`.
 *
 * Public pages resolve canonical URLs and the robots policy from the runtime
 * environment, so Next.js streams their metadata to ordinary browsers. Google
 * only accepts rel=canonical inside `<head>`, and AI crawlers do not run
 * JavaScript, so these user agents get a blocking render with the metadata in
 * the head instead. Next.js's own list (social previews, Bing, …) is kept.
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
  `${HTML_LIMITED_BOT_UA_RE_STRING}|${SEARCH_AND_AI_CRAWLERS.join("|")}`,
  "i",
);
