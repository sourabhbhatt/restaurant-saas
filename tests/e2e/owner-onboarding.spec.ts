import { data, expect, test, uniqueSuffix } from "./support/fixtures";

/**
 * A new owner from the sign-up form to a table a guest can order from
 * (desktop project only): account, workspace, restaurant and branch, first
 * dish, tables, then the QR code a guest scans.
 */
test("a new owner signs up, sets up the restaurant and a guest orders from the first QR code", async ({
  page,
  newContext,
}) => {
  const suffix = uniqueSuffix();
  const restaurant = `Bistro ${suffix}`;
  const dish = `House Thali ${suffix}`;

  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill("E2E Owner");
  await page.getByLabel("Work email").fill(`owner-${suffix}@e2e.test`);
  await page.getByRole("textbox", { name: "Password" }).fill("E2e-Owner-Pass-2026");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/app\/onboarding/);

  // Business → restaurant and branch → first dish → tables.
  await page.getByLabel("Business name").fill(`E2E Group ${suffix}`);
  await page.getByRole("button", { name: "Create workspace" }).click();

  await page.getByLabel("Restaurant name").fill(restaurant);
  await page.getByLabel("First branch name").fill("Main Branch");
  await page.getByLabel("City").fill("Pune");
  await page.getByRole("button", { name: "Create restaurant and branch" }).click();

  await page.getByLabel("Dish name").fill(dish);
  await page.getByLabel("Price").fill("250");
  await page.getByRole("button", { name: "Add dish and continue" }).click();

  await page.getByLabel("How many").fill("3");
  await page.getByRole("button", { name: "Create 3 tables" }).click();

  await expect(page.getByText("You're all set")).toBeVisible();
  await page.getByRole("button", { name: "Open tables & QR codes" }).click();
  await expect(page).toHaveURL(/\/app\/b\/[^/]+\/tables/);
  const branchId = /\/app\/b\/([^/]+)\/tables/.exec(page.url())![1]!;
  await expect(page.getByRole("heading", { name: "Tables & QR" })).toBeVisible();

  // New tables have no QR code yet: the print sheet offers to generate them.
  const [print] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("link", { name: "Print QR codes" }).click(),
  ]);
  await expect(print.getByText("3 tables without a QR code")).toBeVisible();
  await print.getByRole("button", { name: "Generate missing" }).click();
  await expect(print.getByText("3 QR codes generated")).toBeVisible();
  await expect(print.getByText("without a QR code")).toHaveCount(0);

  // The QR codes a guest would scan.
  const sheet = await data<{ tables: { tableName: string; url: string }[]; missing: unknown[] }>(
    await page.request.get(`/api/v1/branches/${branchId}/tables/qr-sheet`),
  );
  expect(sheet.missing).toEqual([]);
  expect(sheet.tables.map((t) => t.tableName).sort()).toEqual(["T1", "T2", "T3"]);

  const guest = await newContext(null);
  await guest.page.goto(new URL(sheet.tables[0]!.url).pathname);
  await expect(guest.page.getByRole("heading", { level: 1, name: restaurant })).toBeVisible();
  await expect(guest.page.getByRole("heading", { name: dish, level: 3 })).toBeVisible();
  await expect(guest.page.getByText("₹250.00").first()).toBeVisible();
});
