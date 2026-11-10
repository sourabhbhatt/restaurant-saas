import { data, expect, test, uniqueSuffix } from "./support/fixtures";

/**
 * A new owner from the sign-up form to a table a guest can order from
 * (desktop project only): account, workspace, restaurant and branch, first
 * dish, tables (their QR codes are created with them), the dashboard's
 * first-order checklist, then the QR code a guest scans.
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

  await expect(page.getByRole("heading", { name: "Your restaurant is set up" })).toBeVisible();
  await page.getByRole("button", { name: "Go to my dashboard" }).click();
  await expect(page).toHaveURL(/\/app\/b\/[^/?#]+$/);
  const branchId = /\/app\/b\/([^/?#]+)/.exec(page.url())![1]!;

  // The tables got their QR codes during setup; the checklist leads to the test order.
  const checklist = page.getByRole("region", { name: "Get ready for your first order" });
  await expect(checklist.getByText("3 of 3 tables have a QR code", { exact: false })).toBeVisible();
  await expect(checklist.getByRole("link", { name: /Open guest menu/ })).toBeVisible();

  // The print sheet has every code and nothing missing.
  await checklist.getByRole("link", { name: /Print QR codes/ }).click();
  await expect(page).toHaveURL(/\/print\/tables\?branchId=/);
  await expect(page.getByRole("img", { name: /^QR code for T\d$/ })).toHaveCount(3);
  await expect(page.getByText("without a QR code")).toHaveCount(0);

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
