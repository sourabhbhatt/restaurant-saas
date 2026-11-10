import type { Page } from "@playwright/test";

import { DEMO_ACCOUNTS, authFile } from "./support/accounts";
import {
  E2E_URLS,
  apiClient,
  data,
  expect,
  newOwner,
  test,
  uniqueSuffix,
} from "./support/fixtures";

/**
 * Super-admin console (admin app, desktop project). Works on a brand-new
 * workspace so trial, status and limit changes never touch the demo data.
 */
const admin = (path: string) => `${E2E_URLS.admin}${path}`;

async function trialDaysLeft(page: Page): Promise<number> {
  const text = await page.getByText(/trial days left/).textContent();
  return Number(/(\d+) trial days left/.exec(text ?? "")?.[1]);
}

test("super admin signs in, finds a workspace, manages its trial, status and limits, and sees the audit trail", async ({
  newContext,
}) => {
  const owner = await newOwner("Admin Target");

  // Sign in on the admin app.
  const { page } = await newContext(null);
  await page.goto(admin("/sign-in"));
  await page.getByLabel("Email").fill(DEMO_ACCOUNTS.admin.email);
  await page.getByRole("textbox", { name: "Password" }).fill(DEMO_ACCOUNTS.admin.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin/);

  // Workspaces list → search → detail.
  await page.goto(admin("/admin/workspaces"));
  await page.getByRole("searchbox", { name: "Search workspaces" }).fill(owner.workspaceName);
  await page.getByRole("row", { name: `Open workspace ${owner.workspaceName}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: owner.workspaceName })).toBeVisible();
  await expect(page.getByText(/Plan Pro · phase\s*TRIAL/)).toBeVisible();
  const members = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText("Members (1)", { exact: true }) });
  await expect(members).toContainText(owner.email);
  await expect(members).toContainText("Workspace Owner");

  // Trial management: extend by 5 days.
  const before = await trialDaysLeft(page);
  // A wording change would make it NaN, and poll(...).toBe(NaN + 5) would pass vacuously.
  expect(before).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Extend trial" }).click();
  const extend = page.getByRole("dialog", { name: "Extend trial" });
  await extend.getByLabel("Days").fill("5");
  await extend.getByLabel("Reason").fill("E2E: onboarding help");
  await extend.getByRole("button", { name: /Extend/ }).click();
  await expect(page.getByText("Trial extended by 5 days")).toBeVisible();
  await expect.poll(() => trialDaysLeft(page)).toBe(before + 5);

  // Account limits: a trial organization may own one workspace; the override allows two.
  const second = { data: { name: `${owner.workspaceName} B` } };
  const blocked = await owner.api.post("/api/v1/workspaces", second);
  expect(blocked.status()).toBe(402);
  expect(
    ((await blocked.json()) as { error: { code: string; details?: { reason?: string } } }).error,
  ).toMatchObject({ code: "LIMIT_REACHED", details: { reason: "PLAN_LIMIT" } });
  await page.getByLabel("Max workspaces override").fill("2");
  await page.getByRole("button", { name: "Save limit" }).click();
  await expect(page.getByText("Workspace limit set to 2")).toBeVisible();
  expect((await owner.api.post("/api/v1/workspaces", second)).status()).toBe(201);

  // Suspend: the owner loses access; reactivate restores it.
  await page.getByRole("button", { name: "Suspend", exact: true }).click();
  const suspend = page.getByRole("alertdialog", { name: "Suspend workspace?" });
  await suspend.getByLabel("Reason").fill("E2E: unpaid invoice");
  await suspend.getByRole("button", { name: "Suspend" }).click();
  await expect(page.getByText("Suspended").first()).toBeVisible();
  // The shell can still load (to show the suspension), but every permissioned action is refused.
  type Shell = { entitlements: { phase: string; accessLevel: string } };
  const structure = `/api/v1/workspaces/${owner.workspaceId}/structure`;
  const suspended = (await data<Shell>(await owner.api.get(structure))).entitlements;
  expect(suspended).toMatchObject({ phase: "SUSPENDED", accessLevel: "NONE" });
  const restaurants = `/api/v1/workspaces/${owner.workspaceId}/restaurants`;
  const refused = await owner.api.post(restaurants, { data: { name: "While suspended" } });
  expect(refused.status()).toBe(403);
  expect(((await refused.json()) as { error: { code: string } }).error.code).toBe(
    "WORKSPACE_RESTRICTED",
  );

  await page.getByRole("button", { name: "Reactivate" }).click();
  const reactivate = page.getByRole("alertdialog", { name: "Reactivate workspace?" });
  await reactivate.getByLabel("Reason").fill("E2E: paid");
  await reactivate.getByRole("button", { name: "Reactivate" }).click();
  await expect(page.getByRole("button", { name: "Suspend", exact: true })).toBeVisible();
  expect((await data<Shell>(await owner.api.get(structure))).entitlements.accessLevel).toBe("FULL");
  await data(await owner.api.post(restaurants, { data: { name: "After reactivation" } }));

  // Every action is in the platform audit log, attributed to the super admin.
  await page.goto(admin("/admin/audit"));
  const filter = page.getByRole("searchbox", { name: "Filter by action" });
  const log = page.getByRole("table", { name: "Audit log" });
  for (const action of ["platform.trial_extended", "platform.workspace_status_changed"]) {
    await filter.fill(action);
    const row = log
      .getByRole("row")
      .filter({ hasText: action })
      .filter({ hasText: owner.workspaceName });
    await expect(row.first()).toBeVisible();
    await expect(row.first()).toContainText(DEMO_ACCOUNTS.admin.email);
  }
  // The limit override is an organization action (no workspace column): match it by target.
  const limitAction = "organization.limit_override_changed";
  await filter.fill(limitAction);
  await expect(
    log
      .getByRole("row")
      .filter({ hasText: limitAction })
      .filter({ hasText: DEMO_ACCOUNTS.admin.email })
      .first(),
  ).toBeVisible();
  const detail = await data<{ organization: { id: string } | null }>(
    await page.request.get(admin(`/api/v1/admin/workspaces/${owner.workspaceId}`)),
  );
  const entries = await data<{
    items: { targetId: string | null; actor: { email: string } | null }[];
  }>(await page.request.get(admin("/api/v1/admin/audit"), { params: { action: limitAction } }));
  const mine = entries.items.filter((e) => e.targetId === detail.organization!.id);
  expect(mine.map((e) => e.actor?.email)).toEqual([DEMO_ACCOUNTS.admin.email]);
  await owner.api.dispose();
});

test("a duplicate plan key is a 422 field error from the production API, not a 500", async () => {
  // createPlan inserts without a pre-check, so the unique index raises the conflict: the
  // runner maps it to UniqueViolationError and the platform service to a 422 field error.
  // This runs on the production build (where Next.js bundles these modules more than once).
  // A private, archived plan with a unique key: never shown on pricing pages.
  const api = await apiClient(authFile("admin"));
  const plan = {
    key: `e2e-${uniqueSuffix()}`,
    name: "E2E private plan",
    description: null,
    currency: "INR",
    monthlyPrice: null,
    annualPrice: null,
    isTrialEligible: false,
    isPublic: false,
    status: "ARCHIVED",
    limits: {
      maxRestaurants: 1,
      maxBranches: 1,
      maxStaff: 1,
      maxTables: 1,
      maxMenuItems: 1,
      storageMb: 1,
    },
    maxWorkspaces: 1,
    features: [],
    sortOrder: 999,
  };
  expect((await api.post("/api/v1/admin/plans", { data: plan })).status()).toBe(201);
  const again = await api.post("/api/v1/admin/plans", { data: plan });
  const body = (await again.json()) as {
    error: { code: string; fieldErrors?: Record<string, string[]> };
  };
  expect(again.status()).toBe(422);
  expect(body.error.code).toBe("VALIDATION_FAILED");
  expect(body.error.fieldErrors?.key).toEqual(["A plan with this key already exists"]);
  await api.dispose();
});

test("a workspace owner is refused by the admin console and its API", async ({
  newContext,
  ownerApi,
}) => {
  const { page } = await newContext("owner");
  await page.goto(admin("/admin"));
  await expect(page.getByRole("heading", { name: "Access denied" })).toBeVisible();
  await expect(page.getByText("This area is restricted to platform administrators.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Workspaces" })).toHaveCount(0);

  expect((await ownerApi.get("/api/v1/admin/workspaces")).status()).toBe(403);
  expect((await ownerApi.get("/api/v1/admin/upgrade-requests")).status()).toBe(403);
  expect((await ownerApi.get("/api/v1/admin/audit")).status()).toBe(403);
});
