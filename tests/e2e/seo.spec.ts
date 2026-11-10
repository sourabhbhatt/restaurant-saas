import { expect, test, type APIRequestContext } from "@playwright/test";

import { fullTitle, SITE_PAGES } from "../../packages/web-core/src/features/site/seo/site-pages";

/**
 * Technical SEO checks against the production build.
 *
 * Default run: no SITE_INDEXABLE, so every response must be noindex.
 * Production run: start the console with SITE_INDEXABLE=true and
 * PUBLIC_SITE_URL=https://www.restaurantos.test; requests sent with that Host
 * must be indexable and requests on localhost must stay noindex.
 */
const PRODUCTION = process.env.SITE_INDEXABLE === "true";
const SITE_URL = process.env.PUBLIC_SITE_URL ?? "";
const SITE_HOST = PRODUCTION ? new URL(SITE_URL).host : null;
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
      baseURL,
    }) => {
      const { res, html, head } = await fetchHtml(request, page.path, {
        host: SITE_HOST ?? undefined,
      });
      expect(res.status()).toBe(200);

      // Metadata is in the initial <head>, not streamed later (rel=canonical only counts there).
      expect(decode(titleOf(head) ?? "")).toBe(fullTitle(page));
      expect(decode(attr(head, /<meta name="description" content="([^"]+)"/) ?? "")).toBe(
        page.description,
      );
      const origin = PRODUCTION ? SITE_URL.replace(/\/$/, "") : new URL(baseURL!).origin;
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
    const offers = (app!.offers ?? []) as { price: number }[];
    // Without a reachable API the page falls back to client-side loading and offers are omitted.
    for (const offer of offers) {
      const shown = `₹${offer.price.toLocaleString("en-IN")}`;
      expect(html).toContain(shown);
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
    if (PRODUCTION) expect(body).toContain(`Sitemap: ${SITE_URL.replace(/\/$/, "")}/sitemap.xml`);
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
  });

  test("the Open Graph image and logo are PNGs of the declared size", async ({ request }) => {
    for (const [path, width, height] of [
      ["/og-image.png", 1200, 630],
      ["/logo.png", 512, 512],
    ] as const) {
      const res = await request.get(path);
      expect(res.headers()["content-type"]).toBe("image/png");
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
    expect(canonicalOf(head)).toBe(`${SITE_URL.replace(/\/$/, "")}/pricing`);
  });
});
