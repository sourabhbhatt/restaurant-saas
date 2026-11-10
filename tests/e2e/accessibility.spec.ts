import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { DEMO } from "./support/accounts";
import { E2E_URLS, expect, qrToken, test } from "./support/fixtures";

/**
 * Automated WCAG 2.1 A/AA checks (axe-core) on the key screens of every app,
 * each on the form factor its users have: public pages and sign-in on phones
 * and desktops; owner screens, kitchen, cashier and Super Admin on desktop;
 * the guest QR menu and the waiter console on phones.
 *
 * No rule is disabled. Each scan waits for the screen's real content first, so
 * it never audits a loading skeleton. axe finds roughly a third of WCAG issues;
 * keyboard, screen-reader and zoom checks stay manual (docs/testing.md).
 */
const WCAG_A_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function expectNoViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_A_AA).analyze();
  // Readable failures: rule, impact, how many elements, and the first few (selector + HTML).
  expect(
    violations.map((v) => ({
      rule: v.id,
      impact: v.impact,
      count: v.nodes.length,
      nodes: v.nodes.slice(0, 3).map((n) => `${n.target.join(" ")} ${n.html.slice(0, 160)}`),
    })),
  ).toEqual([]);
}

const ops = (path: string) => `${E2E_URLS.ops}${path}`;
const admin = (path: string) => `${E2E_URLS.admin}${path}`;

test.describe("public and sign-in pages", () => {
  for (const path of ["/", "/pricing", "/sign-in"]) {
    test(`${path} has no WCAG A/AA violations`, async ({ newContext }) => {
      const { page } = await newContext(null);
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoViolations(page);
    });
  }
});

test.describe("owner screens (desktop)", () => {
  test.skip(({ isMobile }) => isMobile, "owners manage the restaurant on a desktop or laptop");

  test("workspace overview", async ({ newContext, demo }) => {
    const { page } = await newContext("owner");
    await page.goto(`/app/w/${demo.workspaceId}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(DEMO.restaurantName).first()).toBeVisible();
    await expectNoViolations(page);
  });

  test("branch overview", async ({ newContext, demo }) => {
    const { page } = await newContext("owner");
    await page.goto(`/app/b/${demo.branchId}`);
    await expect(page.getByRole("heading", { level: 1, name: DEMO.branchName })).toBeVisible();
    await expect(page.getByText("Recent orders").first()).toBeVisible();
    await expectNoViolations(page);
  });

  test("menu editor", async ({ newContext, demo }) => {
    const { page } = await newContext("owner");
    await page.goto(`/app/b/${demo.branchId}/menu`);
    await expect(page.getByText("Paneer Tikka").first()).toBeVisible();
    await expectNoViolations(page);
  });

  test("tables and the QR print sheet", async ({ newContext, demo }) => {
    const { page } = await newContext("owner");
    await page.goto(`/app/b/${demo.branchId}/tables`);
    await expect(page.getByText("T1", { exact: true }).first()).toBeVisible();
    await expectNoViolations(page);

    await page.goto(`/print/tables?branchId=${demo.branchId}`);
    await expect(page.getByRole("img", { name: "QR code for T1", exact: true })).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe("guest and waiter (phone)", () => {
  test.skip(({ isMobile }) => !isMobile, "guests and waiters use phones");

  test("guest QR menu", async ({ newContext, ownerApi, demo }) => {
    const token = await qrToken(ownerApi, demo.branchId, demo.tables.T1!);
    const { page } = await newContext(null);
    await page.goto(`/t/${token}`);
    await expect(page.getByRole("heading", { level: 1, name: DEMO.restaurantName })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Paneer Tikka" }).first()).toBeVisible();
    await expectNoViolations(page);
  });

  test("waiter console", async ({ newContext, demo }) => {
    const { page } = await newContext("waiter");
    await page.goto(ops(`/waiter/${demo.branchId}`));
    await expect(page.getByRole("heading", { level: 1, name: DEMO.branchName })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Orders/ })).toBeVisible();
    await expectNoViolations(page);
  });
});

test.describe("kitchen, cashier and Super Admin (desktop)", () => {
  test.skip(({ isMobile }) => isMobile, "kitchen tablets, the cashier counter and admins");

  test("kitchen display", async ({ newContext, demo }) => {
    const { page } = await newContext("kitchen");
    await page.goto(ops(`/kitchen/${demo.branchId}`));
    await expect(page.getByRole("heading", { level: 1, name: /Kitchen/ })).toBeVisible();
    await expectNoViolations(page);
  });

  test("cashier console", async ({ newContext, demo }) => {
    const { page } = await newContext("cashier");
    await page.goto(ops(`/cashier/${demo.branchId}`));
    await expect(page.getByRole("heading", { name: "Queue" })).toBeVisible();
    await expectNoViolations(page);
  });

  test("Super Admin home", async ({ newContext }) => {
    const { page } = await newContext("admin");
    await page.goto(admin("/admin"));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expectNoViolations(page);
  });
});
