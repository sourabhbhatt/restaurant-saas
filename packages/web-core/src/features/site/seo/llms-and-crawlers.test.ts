import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { HTML_LIMITED_BOT_UA_RE as NEXT_INTERNAL_HTML_LIMITED_BOT_UA_RE } from "next/dist/shared/lib/router/utils/html-bots";
import { billDiscountSchema } from "@ros/contracts/billing";
import { describe, expect, it } from "vitest";

import { ALL_FAQ_ITEMS } from "../faq-data";
import { FEATURE_DETAILS } from "../feature-details";
import { parsePublicPlans } from "../pricing/plan-model";
import { HTML_LIMITED_BOTS, NEXT_DEFAULT_HTML_LIMITED_BOTS } from "./crawlers";
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

  it("lists live plan prices, excluding GST, from the same plan data as the site", () => {
    const plans = parsePublicPlans([
      {
        key: "starter",
        name: "Starter",
        currency: "INR",
        monthlyPrice: 49900,
        annualPrice: 499000,
      },
      { key: "pro", name: "Pro", currency: "INR", monthlyPrice: 199900, annualPrice: null },
      { key: "enterprise", name: "Enterprise", currency: "INR", monthlyPrice: null },
    ]);
    const priced = buildLlmsTxt(PROD, plans);
    const section = priced.slice(
      priced.indexOf("## Pricing"),
      priced.indexOf("## Common questions"),
    );
    expect(section).toContain("- Starter: ₹499/month or ₹4,990/year");
    expect(section).toContain("- Pro: ₹1,999/month");
    expect(section).toContain("- Enterprise: custom pricing (contact us)");
    expect(section).toContain("Prices exclude GST.");
    expect(section).toContain("https://www.restaurantos.in/pricing");
  });

  it("points to the pricing page when the plans are unavailable", () => {
    const section = text.slice(text.indexOf("## Pricing"), text.indexOf("## Common questions"));
    expect(section).toContain("## Pricing");
    expect(section).toContain("https://www.restaurantos.in/pricing");
    expect(section).not.toContain("₹");
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

  it("keeps Next.js's default list without importing Next internals at build time", () => {
    const source = readFileSync(path.join(import.meta.dirname, "crawlers.ts"), "utf8");
    expect(source).not.toMatch(/from "next\/dist\//);
    expect(HTML_LIMITED_BOTS.source.startsWith(`${NEXT_DEFAULT_HTML_LIMITED_BOTS}|`)).toBe(true);
  });

  it("vendored default list matches the installed Next.js (update crawlers.ts when this fails)", () => {
    // Test-only import of the internal module behind the documented default list.
    expect(NEXT_DEFAULT_HTML_LIMITED_BOTS).toBe(NEXT_INTERNAL_HTML_LIMITED_BOT_UA_RE.source);
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

  it("quotes UI labels exactly as the apps show them", () => {
    const quoted = [...JSON.stringify(FEATURE_DETAILS).matchAll(/“([^”]+)”/g)].map((m) => m[1]!);
    expect(quoted.length).toBeGreaterThan(0);
    const repo = path.resolve(import.meta.dirname, "../../../../../..");
    const uiSources = [
      ...sourceFiles(path.join(repo, "apps/ops/src")),
      ...sourceFiles(path.join(repo, "apps/console/src")),
      ...sourceFiles(path.join(repo, "packages/web-core/src")).filter(
        (file) => !file.includes(`${path.sep}features${path.sep}site${path.sep}`),
      ),
    ].map((file) => readFileSync(file, "utf8"));
    for (const label of quoted) {
      expect(
        uiSources.some((text) => text.includes(label)),
        `“${label}” is not a UI string`,
      ).toBe(true);
    }
  });

  it("never claims that guest QR pages work offline (only staff routes register the worker)", () => {
    const repo = path.resolve(import.meta.dirname, "../../../../../..");
    // The code fact the copy depends on: StaffOffline is mounted only by staff layouts.
    const providers = readFileSync(
      path.join(repo, "packages/web-core/src/app-providers.tsx"),
      "utf8",
    );
    expect(providers).toMatch(/register=\{false\}/);
    const mounts = ["apps/console/src", "apps/ops/src"]
      .flatMap((dir) => sourceFiles(path.join(repo, dir)))
      .filter((file) => readFileSync(file, "utf8").includes("@ros/web-core/staff-offline"))
      .map((file) => path.relative(repo, file));
    expect(mounts.length).toBeGreaterThan(0);
    for (const file of mounts) {
      expect(file).toMatch(/^apps\/(console\/src\/app\/(app|print)\/|ops\/src\/)/);
    }

    // Public copy: no offline browsing of a guest menu, no "drafts" (no screen saves drafts).
    const siteDir = path.join(repo, "packages/web-core/src/features/site");
    const copy = [
      JSON.stringify(FEATURE_DETAILS),
      JSON.stringify(ALL_FAQ_ITEMS),
      buildLlmsTxt(PROD),
      ...["features-page.tsx", "landing/offline.tsx", "legal/terms.tsx", "legal/privacy.tsx"].map(
        (file) => readFileSync(path.join(siteDir, file), "utf8"),
      ),
    ].join("\n");
    expect(copy).not.toMatch(/browsed offline|can still be browsed|drafts/i);

    const offline = FEATURE_DETAILS.find((d) => d.path === "/features/offline-mode")!;
    const needsConnection = offline.details.find((d) => d.title === "Needs a connection")!;
    expect(needsConnection.points.join("\n")).toMatch(/opening or reloading a guest's QR menu/i);
    const faq = ALL_FAQ_ITEMS.find((i) => i.id === "offline")!;
    expect(faq.answer.join(" ")).toMatch(/guest QR pages are not saved for offline use/i);
  });

  it("describes the discount reason as optional, as the billing contract does", () => {
    expect(billDiscountSchema.safeParse({ type: "FLAT", value: 5000 }).success).toBe(true);
    const billing = JSON.stringify(
      FEATURE_DETAILS.find((d) => d.path === "/features/restaurant-billing"),
    );
    expect(billing).toMatch(/discount/i);
    expect(billing).not.toMatch(/discounts?[^.]*, with a reason/i);
    expect(billing).toMatch(/optional reason/);
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => path.join(dir, file));
}
