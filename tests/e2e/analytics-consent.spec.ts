import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Google Analytics stays off the network unless a Measurement ID is
 * configured AND the visitor opted in (docs/growth/analytics-events.md).
 *
 * The default run has no GA_MEASUREMENT_ID: the first block proves the app is
 * inert. To cover the consent flow, run this file against a console started
 * with a test stream id (requests to Google are stubbed, nothing leaves):
 *   GA_MEASUREMENT_ID=G-E2ETEST01 pnpm test:e2e tests/e2e/analytics-consent.spec.ts
 */
const MEASUREMENT_ID = process.env.GA_MEASUREMENT_ID;
const GOOGLE =
  /^https:\/\/([a-z0-9-]+\.)*(googletagmanager\.com|google-analytics\.com|analytics\.google\.com|doubleclick\.net)\//;

// Every request is visible to the page, none is answered by the service worker's cache.
test.use({ serviceWorkers: "block" });

/** Records every request to a Google analytics host; answers them locally so nothing leaves. */
async function watchGoogle(context: BrowserContext): Promise<string[]> {
  const hits: string[] = [];
  await context.route(GOOGLE, async (route) => {
    hits.push(route.request().url());
    const isScript = route.request().url().includes("/gtag/js");
    await route.fulfill(
      isScript
        ? { status: 200, contentType: "application/javascript", body: "/* gtag.js stub */" }
        : { status: 204, body: "" },
    );
  });
  return hits;
}

const banner = (page: Page) => page.getByTestId("analytics-consent");

async function gtagCommands(page: Page): Promise<unknown[][]> {
  return page.evaluate(() =>
    ((window as { dataLayer?: unknown[] }).dataLayer ?? []).map((e) =>
      Array.from(e as ArrayLike<unknown>),
    ),
  );
}

async function pageViews(page: Page): Promise<Record<string, unknown>[]> {
  return (await gtagCommands(page))
    .filter((c) => c[0] === "event" && c[1] === "page_view")
    .map((c) => c[2] as Record<string, unknown>);
}

test.describe("without a Measurement ID", () => {
  test.skip(Boolean(MEASUREMENT_ID), "this console was started with GA_MEASUREMENT_ID");

  test("no banner, no tag and no request to Google on any page", async ({ page, context }) => {
    const hits = await watchGoogle(context);
    for (const path of ["/", "/pricing", "/legal/privacy", "/sign-in", "/t/not-a-real-table"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    await page.goto("/sign-up");
    await page.getByLabel(/full name/i).fill("No Tracking");
    await expect(banner(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cookie settings" })).toHaveCount(0);
    expect(await page.evaluate(() => "dataLayer" in window)).toBe(false);
    expect(hits).toEqual([]);
  });
});

test.describe("with a Measurement ID", () => {
  test.skip(!MEASUREMENT_ID, "start the console with GA_MEASUREMENT_ID=G-… to run");

  test("nothing reaches Google before a choice is made", async ({ page, context }) => {
    const hits = await watchGoogle(context);
    await page.goto("/");
    await expect(banner(page)).toBeVisible();
    await page.goto("/pricing");
    await page.goto("/sign-up");
    await page.getByLabel(/full name/i).fill("Undecided Visitor");
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => "dataLayer" in window)).toBe(false);
    expect(hits).toEqual([]);
  });

  test("declining keeps Google out across navigations and reloads", async ({ page, context }) => {
    const hits = await watchGoogle(context);
    await page.goto("/");
    await banner(page).getByRole("button", { name: "Decline" }).click();
    await expect(banner(page)).toHaveCount(0);
    await page.goto("/features");
    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect(banner(page)).toHaveCount(0);
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "ros_analytics_consent")?.value).toBe("denied");
    expect(cookies.some((c) => c.name.startsWith("_ga"))).toBe(false);
    expect(hits).toEqual([]);
  });

  test("allowing loads gtag.js once and sends one page_view per client navigation", async ({
    page,
    context,
  }) => {
    const hits = await watchGoogle(context);
    await page.goto("/?utm_source=e2e&utm_medium=test&email=visitor%40example.com");
    await banner(page).getByRole("button", { name: "Allow analytics" }).click();
    await expect(banner(page)).toHaveCount(0);
    await expect.poll(() => hits.length).toBeGreaterThan(0);
    expect(hits.every((u) => u.startsWith("https://www.googletagmanager.com/gtag/js?id="))).toBe(
      true,
    );
    await expect.poll(async () => (await pageViews(page)).length).toBe(1);

    // Client-side navigation through a footer link, then back.
    await page.getByRole("contentinfo").getByRole("link", { name: "Pricing" }).click();
    await expect(page).toHaveURL(/\/pricing$/);
    await expect.poll(async () => (await pageViews(page)).length).toBe(2);
    await page.goBack();
    await expect.poll(async () => (await pageViews(page)).length).toBe(3);

    const views = await pageViews(page);
    expect(views.map((v) => new URL(String(v.page_location)).pathname)).toEqual([
      "/",
      "/pricing",
      "/",
    ]);
    expect(String(views[0]!.page_location)).toContain("utm_source=e2e");
    expect(JSON.stringify(await gtagCommands(page))).not.toContain("visitor");
    // gtag.js was requested once for the whole visit.
    expect(hits.filter((u) => u.includes("/gtag/js"))).toHaveLength(1);
  });

  test("sign-up events carry no personal data", async ({ page, context }) => {
    await watchGoogle(context);
    await page.goto("/sign-up");
    await banner(page).getByRole("button", { name: "Allow analytics" }).click();
    const email = `e2e-ga-${Date.now()}@example.com`;
    await page.getByLabel(/full name/i).fill("Analytics Tester");
    await page.getByLabel(/work email/i).fill(email);
    await page.getByLabel(/^password/i).fill("correct-horse-battery-42");
    await page.getByLabel(/i agree/i).check();
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/app\//, { timeout: 20_000 });

    const names = (await gtagCommands(page)).filter((c) => c[0] === "event").map((c) => c[1]);
    expect(names).toEqual(expect.arrayContaining(["signup_started", "signup_completed"]));
    expect(names.filter((n) => n === "signup_completed")).toHaveLength(1);
    const sent = JSON.stringify(await gtagCommands(page));
    expect(sent).not.toContain(email);
    expect(sent).not.toContain("Analytics Tester");
    expect(sent).not.toContain("correct-horse");
  });

  test("guest QR pages never show the banner or load the tag, even after opting in", async ({
    page,
    context,
  }) => {
    const hits = await watchGoogle(context);
    await page.goto("/");
    await banner(page).getByRole("button", { name: "Allow analytics" }).click();
    await expect.poll(() => hits.length).toBeGreaterThan(0);

    const guest = await context.newPage();
    const before = hits.length;
    await guest.goto("/t/GYw3TEwFZ7bpHJOKMnagBoWJxEwV-PffDfEFKcigOg4");
    await guest.waitForLoadState("networkidle");
    await expect(banner(guest)).toHaveCount(0);
    expect(await guest.evaluate(() => "dataLayer" in window)).toBe(false);
    expect(hits.length).toBe(before);
  });

  test("the footer link reopens the choice and a withdrawal removes GA cookies", async ({
    page,
    context,
  }) => {
    await watchGoogle(context);
    await page.goto("/");
    await banner(page).getByRole("button", { name: "Allow analytics" }).click();
    await context.addCookies([
      { name: "_ga", value: "GA1.1.123456789.1790000000", url: new URL(page.url()).origin },
    ]);
    await page.getByRole("contentinfo").getByRole("button", { name: "Cookie settings" }).click();
    await expect(banner(page)).toContainText("Current choice: allowed");
    await banner(page).getByRole("button", { name: "Decline" }).click();
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "ros_analytics_consent")?.value).toBe("denied");
    expect(cookies.some((c) => c.name === "_ga")).toBe(false);
    expect(await page.evaluate((id) => (window as never)[`ga-disable-${id}`], MEASUREMENT_ID)).toBe(
      true,
    );
  });
});
