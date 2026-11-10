import { expect, freshTable, qrToken, test } from "./support/fixtures";

test("home page renders", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page).toHaveTitle(/RestaurantOS/);
});

test("web app manifest is linked and valid", async ({ page, request }) => {
  await page.goto("/");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBe("/manifest.json");

  const res = await request.get("/manifest.json");
  expect(res.ok()).toBeTruthy();
  const manifest = (await res.json()) as { display: string; icons: { sizes: string }[] };
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.map((i) => i.sizes)).toEqual(
    expect.arrayContaining(["192x192", "512x512"]),
  );
});

test("service worker is served and takes control on the signed-in area", async ({
  request,
  newContext,
}) => {
  const sw = await request.get("/serwist/sw.js");
  expect(sw.ok()).toBeTruthy();
  expect(sw.headers()["cache-control"]).toContain("no-cache");

  const { page } = await newContext("owner");
  await page.goto("/app");
  const scope = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    return registration.scope;
  });
  expect(scope).toMatch(/\/$/);
});

test("public and guest pages do not install the service worker", async ({
  page,
  ownerApi,
  demo,
}) => {
  const table = await freshTable(ownerApi, demo.otherBranchId);
  const token = await qrToken(ownerApi, table.branchId, table.id);
  // Marketing visitors and guests on mobile data never download the staff precache.
  for (const path of ["/", "/pricing", "/sign-in", `/t/${token}`]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const registrations = await page.evaluate(
      async () => (await navigator.serviceWorker.getRegistrations()).length,
    );
    expect(registrations, path).toBe(0);
  }
});

test("offline fallback page is shown for uncached pages when offline", async ({ newContext }) => {
  const { page, context } = await newContext("owner");
  await page.goto("/app");
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Let the worker finish precaching before cutting the network.
  await page.waitForFunction(async () => {
    const keys = await caches.keys();
    for (const key of keys) {
      const cache = await caches.open(key);
      const hit = await cache.match("/~offline", { ignoreSearch: true });
      if (hit) return true;
    }
    return false;
  });

  await context.setOffline(true);
  await page.goto("/this-page-was-never-visited");
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  await context.setOffline(false);
});
