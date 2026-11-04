import { expect, test } from "@playwright/test";

test.describe("public site", () => {
  test("landing page renders the hero and the trial CTA", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("your team in control");
    const cta = page
      .getByRole("main")
      .getByRole("link", { name: /start free trial/i })
      .first();
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "/sign-up");
    await expect(page.getByRole("heading", { name: /three steps/i })).toBeVisible();
    // Offline limitations are stated plainly.
    await expect(page.getByText("Confirming a payment", { exact: true })).toBeVisible();
  });

  test("pricing page shows live plans or a recoverable error", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const plans = page.locator("article[aria-labelledby^='plan-']");
    const error = page.getByText("Pricing couldn't be loaded");
    const empty = page.getByText("Plans are being finalised");
    await expect(plans.first().or(error).or(empty)).toBeVisible({ timeout: 15_000 });
    if (await error.isVisible()) {
      await expect(page.getByRole("button", { name: /try again/i })).toBeVisible();
    }
  });

  test("legal pages are marked as templates", async ({ page }) => {
    for (const path of ["/legal/privacy", "/legal/terms", "/legal/refunds"]) {
      await page.goto(path);
      await expect(page.getByText(/Template — review with a lawyer before launch/)).toBeVisible();
    }
  });

  test("unknown pages show the styled 404", async ({ page }) => {
    const res = await page.goto("/this-page-does-not-exist");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: /couldn't find that page/i })).toBeVisible();
  });
});

test.describe("auth pages", () => {
  test("sign-up shows field validation errors", async ({ page }) => {
    await page.goto("/sign-up");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Enter your full name")).toBeVisible();
    await expect(page.getByText("Email is required")).toBeVisible();
    await expect(page.getByText("You must accept the terms to continue")).toBeVisible();
    await expect(page.getByLabel(/full name/i)).toHaveAttribute("aria-invalid", "true");

    await page.getByLabel(/^password/i).fill("short");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByText("Use at least 10 characters")).toBeVisible();
  });

  test("sign-in with a wrong password shows the generic error", async ({ page }) => {
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill(`nobody-${Date.now()}@example.com`);
    await page.getByLabel(/^password/i).fill("definitely-wrong-123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Email or password is incorrect")).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);
  });

  test("reset-password without a token offers a new link", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: /isn't valid/i })).toBeVisible();
    await expect(page.getByRole("link", { name: "Request a new link" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });
});
