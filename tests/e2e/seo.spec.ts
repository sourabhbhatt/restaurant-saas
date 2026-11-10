import { expect, test, type APIRequestContext } from "@playwright/test";

import { resolveSiteConfig } from "../../packages/web-core/src/features/site/seo/site-config";
import { fullTitle, SITE_PAGES } from "../../packages/web-core/src/features/site/seo/site-pages";

/**
 * Technical SEO checks against the production build.
 *
 * Default run: no SITE_INDEXABLE, so every response must be noindex.
 * Production run: start the console with SITE_INDEXABLE=true and
 * PUBLIC_SITE_URL=https://www.restaurantos.test; requests sent with that Host
 * must be indexable and requests on localhost must stay noindex.
 * The console inherits this process's environment, so the expected origin is
 * resolved from the same variables (PUBLIC_SITE_URL, then CONSOLE_URL).
 */
const SITE = resolveSiteConfig(process.env);
const PRODUCTION = SITE.indexable;
const SITE_URL = SITE.origin;
const SITE_HOST = PRODUCTION ? SITE.host : null;
const NOINDEX = "noindex, nofollow";
const GOOGLEBOT = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const GPTBOT =
  "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot";

async function fetchHtml(
  request: APIRequestContext,
  path: string,
  options: { userAgent?: string; host?: string } = {},
) {
  const headers: Record<string, string> = { "user-agent": options.userAgent ?? GOOGLEBOT };
  if (options.host) headers.host = options.host;
  const res = await request.get(path, { headers, maxRedirects: 0 });
  const html = await res.text();
  const headEnd = html.indexOf("</head>");
  return { res, html, head: headEnd > 0 ? html.slice(0, headEnd) : "" };
}

const attr = (html: string, pattern: RegExp) => html.match(pattern)?.[1] ?? null;
const canonicalOf = (head: string) => attr(head, /<link rel="canonical" href="([^"]+)"/);
const robotsMetaOf = (head: string) => attr(head, /<meta name="robots" content="([^"]+)"/);
const titleOf = (head: string) => attr(head, /<title>([^<]*)<\/title>/);
const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"');

function jsonLdBlocks(html: string): Record<string, unknown>[] {
  return [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)].map(
    (m) => JSON.parse(m[1]!) as Record<string, unknown>,
  );
}

test.describe("public pages are server-rendered for crawlers", () => {
  for (const page of SITE_PAGES) {
    test(`${page.path}: title, description, canonical, robots, h1 and JSON-LD in the HTML`, async ({
      request,
    }) => {
      const { res, html, head } = await fetchHtml(request, page.path, {
        host: SITE_HOST ?? undefined,
      });
      expect(res.status()).toBe(200);

      // Metadata is in the initial <head>, not streamed later (rel=canonical only counts there).
      expect(decode(titleOf(head) ?? "")).toBe(fullTitle(page));
      const description = decode(attr(head, /<meta name="description" content="([^"]+)"/) ?? "");
      if (page.path === "/pricing") {
        // Leads with the live starting price (the E2E API is seeded with plans).
        expect(description).toMatch(/^Plans from ₹[\d,]+ a month, excluding GST,/);
        const shown = description.match(/₹[\d,]+/)![0];
        expect(html.slice(html.indexOf('<article aria-labelledby="plan-'))).toContain(shown);
      } else {
        expect(description).toBe(page.description);
      }
      const origin = SITE_URL;
      expect(canonicalOf(head)).toBe(`${origin}${page.path}`);
      expect(attr(head, /<meta property="og:url" content="([^"]+)"/)).toBe(`${origin}${page.path}`);
      expect(attr(head, /<meta property="og:image" content="([^"]+)"/)).toBe(
        `${origin}/og-image.png`,
      );
      expect(attr(head, /<meta name="twitter:card" content="([^"]+)"/)).toBe("summary_large_image");

      if (PRODUCTION) {
        expect(robotsMetaOf(head)).toBe("index, follow");
        expect(res.headers()["x-robots-tag"]).toBeUndefined();
      } else {
        expect(robotsMetaOf(head)).toBe("noindex, nofollow");
        expect(res.headers()["x-robots-tag"]).toBe(NOINDEX);
      }

      // Exactly one h1, and it is real server-rendered text.
      const h1s = [...html.matchAll(/<h1[\s>][\s\S]*?<\/h1>/g)];
      expect(h1s).toHaveLength(1);

      // Fragment links (#no-app, #offline …) need unique element ids.
      const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
      expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);

      // JSON-LD parses and uses absolute URLs on the same origin.
      const blocks = jsonLdBlocks(html);
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(block["@context"]).toBe("https://schema.org");
        const json = JSON.stringify(block);
        for (const [, url] of json.matchAll(/"(?:url|item|@id)":"([^"]+)"/g)) {
          expect(url!.startsWith(`${origin}/`)).toBe(true);
        }
        expect(json).not.toMatch(/aggregateRating|FAQPage/);
      }
      const types = blocks.flatMap((b) =>
        (b["@graph"] as { "@type": string }[]).map((n) => n["@type"]),
      );
      if (page.path === "/") expect(types).toEqual(["Organization", "WebSite", "WebApplication"]);
      else expect(types).toContain("BreadcrumbList");
    });
  }

  test("pricing shows real prices in the HTML, matching the structured data offers", async ({
    request,
  }) => {
    const { html } = await fetchHtml(request, "/pricing", { host: SITE_HOST ?? undefined });
    const graph = jsonLdBlocks(html).flatMap((b) => b["@graph"] as Record<string, unknown>[]);
    const app = graph.find((n) => n["@type"] === "WebApplication");
    expect(app).toBeDefined();
    // The E2E API is seeded with plans, so the server render must have loaded them
    // (if it fell back to the browser fetch, offers would be missing).
    const offers = (app!.offers ?? []) as { price: number }[];
    expect(offers.length).toBeGreaterThan(0);
    // Next streams dynamic responses for every user agent, bots included: the
    // skeleton comes first and the cards follow later in the same HTML (a hidden
    // segment an inline script swaps in). The prices must be in those
    // server-rendered cards, not only in the JSON-LD.
    const body = html.slice(html.indexOf("<body"));
    const firstCard = body.indexOf('<article aria-labelledby="plan-');
    expect(firstCard).toBeGreaterThan(-1);
    for (const offer of offers) {
      const shown = `₹${offer.price.toLocaleString("en-IN")}`;
      expect(body.indexOf(shown, firstCard)).toBeGreaterThan(firstCard);
    }
  });

  test("AI crawlers get the same server-rendered metadata", async ({ request }) => {
    const { head } = await fetchHtml(request, "/features/qr-code-ordering", {
      userAgent: GPTBOT,
      host: SITE_HOST ?? undefined,
    });
    expect(canonicalOf(head)).toMatch(/\/features\/qr-code-ordering$/);
    expect(titleOf(head)).toContain("QR code ordering system for restaurants");
  });
});

test.describe("browsers see the same metadata after streaming", () => {
  test("title, canonical and breadcrumbs on a feature page", async ({ page }) => {
    await page.goto("/features/kitchen-display-system");
    await expect(page).toHaveTitle("Kitchen display system (KDS) for restaurants · RestaurantOS");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      /\/features\/kitchen-display-system$/,
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "A kitchen display system that runs in the browser",
    );
    const crumbs = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(crumbs.getByRole("link", { name: "Features" })).toHaveAttribute(
      "href",
      "/features",
    );
    await expect(crumbs.locator('[aria-current="page"]')).toHaveText("Kitchen display system");
  });

  test("the streamed plan cards replace the pricing skeleton", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.locator("article[aria-labelledby^='plan-']").first()).toBeVisible();
    await expect(page.getByText(/₹\d/).first()).toBeVisible();
    await expect(page.getByRole("status", { name: "Loading plans" })).toHaveCount(0);
  });

  // Checked in the hydrated DOM: streamed content (plan cards, "Compare plans")
  // arrives at the end of the raw HTML, so the HTML order is not the page order.
  for (const sitePage of SITE_PAGES) {
    test(`${sitePage.path}: heading levels never skip`, async ({ page }) => {
      await page.goto(sitePage.path);
      if (sitePage.path === "/" || sitePage.path === "/pricing") {
        await expect(page.locator("article[aria-labelledby^='plan-']").first()).toBeVisible();
      }
      const levels = await page.$$eval("h1, h2, h3, h4, h5, h6", (headings) =>
        headings.filter((h) => !h.closest("[hidden]")).map((h) => Number(h.tagName[1])),
      );
      expect(levels[0]).toBe(1);
      expect(levels.filter((level) => level === 1)).toHaveLength(1);
      const skips = levels.flatMap((level, i) =>
        i > 0 && level > levels[i - 1]! + 1 ? [`h${levels[i - 1]} → h${level}`] : [],
      );
      expect(skips).toEqual([]);
    });
  }

  test("feature pages are reachable from the features page and footer", async ({ page }) => {
    await page.goto("/features");
    await page.getByRole("link", { name: "QR code ordering in detail" }).click();
    await expect(page).toHaveURL(/\/features\/qr-code-ordering$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "QR code ordering for dine-in restaurants",
    );
    const footer = page.getByRole("contentinfo");
    await expect(footer.getByRole("link", { name: "Offline mode" })).toHaveAttribute(
      "href",
      "/features/offline-mode",
    );
  });
});

test.describe("private routes are never indexable", () => {
  for (const path of ["/t/not-a-real-token", "/sign-in", "/sign-up", "/print/tables"]) {
    test(`${path} carries noindex`, async ({ request }) => {
      const { res, head } = await fetchHtml(request, path, { host: SITE_HOST ?? undefined });
      expect(res.headers()["x-robots-tag"]).toBe(NOINDEX);
      expect(robotsMetaOf(head)).toMatch(/^noindex/);
      expect(canonicalOf(head)).toBeNull();
    });
  }

  test("/app redirects signed-out visitors with noindex", async ({ request }) => {
    const res = await request.get("/app", {
      headers: SITE_HOST ? { host: SITE_HOST } : {},
      maxRedirects: 0,
    });
    expect(res.status()).toBe(307);
    expect(res.headers()["x-robots-tag"]).toBe(NOINDEX);
  });

  test("the API proxy carries noindex", async ({ request }) => {
    const res = await request.get("/api/v1/health");
    expect(res.headers()["x-robots-tag"]).toBe(NOINDEX);
  });

  test("app icons and optimised copies of non-site images carry noindex", async ({ request }) => {
    const headers: Record<string, string> = SITE_HOST ? { host: SITE_HOST } : {};
    const icon = await request.get("/icons/icon-192.png", { headers });
    expect(icon.headers()["x-robots-tag"]).toBe(NOINDEX);
    const optimised = await request.get("/_next/image?url=%2Ficons%2Ficon-192.png&w=64&q=75", {
      headers,
    });
    expect(optimised.headers()["x-robots-tag"]).toBe(NOINDEX);
  });

  test("unknown URLs return a noindex 404 with links back to the site", async ({ page }) => {
    const res = await page.goto("/this-page-does-not-exist");
    expect(res?.status()).toBe(404);
    expect(res?.headers()["x-robots-tag"]).toBe(NOINDEX);
    await expect(page.locator('meta[name="robots"]').first()).toHaveAttribute("content", /noindex/);
    await expect(
      page.getByRole("navigation", { name: "Site pages" }).getByRole("link", { name: "Pricing" }),
    ).toHaveAttribute("href", "/pricing");
  });
});

test.describe("robots.txt, sitemap.xml and llms.txt", () => {
  test("robots.txt blocks private areas and lists the sitemap only in production", async ({
    request,
  }) => {
    const res = await request.get("/robots.txt", {
      headers: SITE_HOST ? { host: SITE_HOST } : {},
    });
    expect(res.ok()).toBeTruthy();
    const body = await res.text();
    for (const rule of ["Disallow: /app", "Disallow: /t/", "Disallow: /api/", "Disallow: /print"]) {
      expect(body).toContain(rule);
    }
    expect(body).not.toMatch(/Disallow: \/\s*$/m);
    if (PRODUCTION) expect(body).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
    else expect(body).not.toContain("Sitemap:");
  });

  test("sitemap.xml lists public pages only in production", async ({ request }) => {
    const res = await request.get("/sitemap.xml", {
      headers: SITE_HOST ? { host: SITE_HOST } : {},
    });
    expect(res.ok()).toBeTruthy();
    const locs = [...(await res.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    if (PRODUCTION) {
      expect(locs).toHaveLength(SITE_PAGES.length);
      expect(locs.every((loc) => loc!.startsWith("https://"))).toBe(true);
      expect(locs.some((loc) => /\/(app|t|sign-in)(\/|$)/.test(new URL(loc!).pathname))).toBe(
        false,
      );
    } else {
      expect(locs).toEqual([]);
    }
  });

  test("llms.txt is Markdown with absolute links to public pages", async ({ request }) => {
    const res = await request.get("/llms.txt");
    expect(res.ok()).toBeTruthy();
    expect(res.headers()["content-type"]).toContain("text/markdown");
    const body = await res.text();
    expect(body.startsWith("# RestaurantOS\n")).toBe(true);
    expect(body).toMatch(/\]\(https?:\/\/[^)]+\/pricing\)/);
    // Live prices as plain text (the E2E API is seeded with plans).
    const pricing = body.slice(body.indexOf("## Pricing"), body.indexOf("## Common questions"));
    expect(pricing).toMatch(/^- .+: ₹[\d,]+\/month/m);
    expect(pricing).toContain("Prices exclude GST.");
  });

  test("the Open Graph image and logo are PNGs of the declared size", async ({ request }) => {
    for (const [path, width, height] of [
      ["/og-image.png", 1200, 630],
      ["/logo.png", 512, 512],
    ] as const) {
      const res = await request.get(path, { headers: SITE_HOST ? { host: SITE_HOST } : {} });
      expect(res.headers()["content-type"]).toBe("image/png");
      // Google requires the Organization logo to be indexable: only on the production site.
      if (PRODUCTION) expect(res.headers()["x-robots-tag"]).toBeUndefined();
      else expect(res.headers()["x-robots-tag"]).toBe(NOINDEX);
      const png = await res.body();
      expect(png.readUInt32BE(16)).toBe(width);
      expect(png.readUInt32BE(20)).toBe(height);
    }
  });
});

test.describe("production host check", () => {
  test.skip(!PRODUCTION, "needs SITE_INDEXABLE=true and PUBLIC_SITE_URL");

  test("the same build served on another host (staging, *.run.app, localhost) stays noindex", async ({
    request,
  }) => {
    const { res, head } = await fetchHtml(request, "/pricing");
    expect(res.headers()["x-robots-tag"]).toBe(NOINDEX);
    expect(robotsMetaOf(head)).toBe("noindex, nofollow");
    // The canonical still names the production page.
    expect(canonicalOf(head)).toBe(`${SITE_URL}/pricing`);
    for (const path of ["/logo.png", "/og-image.png"]) {
      expect((await request.get(path)).headers()["x-robots-tag"]).toBe(NOINDEX);
    }
  });
});
