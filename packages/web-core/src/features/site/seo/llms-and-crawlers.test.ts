import { describe, expect, it } from "vitest";

import { ALL_FAQ_ITEMS } from "../faq-data";
import { FEATURE_DETAILS } from "../feature-details";
import { HTML_LIMITED_BOTS } from "./crawlers";
import { buildLlmsTxt } from "./llms-txt";
import { CONSOLE_DISALLOW } from "./robots-policy";
import { resolveSiteConfig } from "./site-config";
import { isPublicSitePath } from "./site-pages";

const PROD = resolveSiteConfig({
  SITE_INDEXABLE: "true",
  PUBLIC_SITE_URL: "https://www.restaurantos.in",
});

describe("llms.txt", () => {
  const text = buildLlmsTxt(PROD);

  it("follows the llmstxt.org layout: H1 name, blockquote summary, link lists", () => {
    const lines = text.split("\n");
    expect(lines[0]).toBe("# RestaurantOS");
    expect(lines[2]?.startsWith("> ")).toBe(true);
    expect(text).toContain("## Pages");
    expect(text).toContain("## Optional");
  });

  it("links only to public pages, with absolute URLs", () => {
    const links = [...text.matchAll(/\]\((https?:\/\/[^)]+)\)/g)].map((m) => new URL(m[1]!));
    expect(links.length).toBeGreaterThan(5);
    for (const url of links) {
      expect(url.origin).toBe("https://www.restaurantos.in");
      expect(isPublicSitePath(url.pathname)).toBe(true);
      expect(CONSOLE_DISALLOW.some((p) => url.pathname.startsWith(p))).toBe(false);
    }
  });

  it("states the limits plainly", () => {
    expect(text).toMatch(/Not available yet: online payments/);
  });
});

describe("crawlers that get metadata in the initial <head>", () => {
  it.each([
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
    "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    "WhatsApp/2.23.20.0",
  ])("matches %s", (ua) => expect(HTML_LIMITED_BOTS.test(ua)).toBe(true));

  it("does not match ordinary browsers", () => {
    expect(
      HTML_LIMITED_BOTS.test(
        "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36",
      ),
    ).toBe(false);
  });
});

describe("feature page content", () => {
  it("references FAQ items and pages that exist", () => {
    const faqIds = new Set(ALL_FAQ_ITEMS.map((i) => i.id));
    for (const detail of FEATURE_DETAILS) {
      for (const id of detail.faqIds) expect(faqIds.has(id)).toBe(true);
      for (const path of detail.related) expect(isPublicSitePath(path)).toBe(true);
      expect(detail.limits.length).toBeGreaterThan(0);
    }
  });
});
