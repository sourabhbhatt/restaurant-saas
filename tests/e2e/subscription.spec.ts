import { E2E_URLS, data, expect, newOwner, test } from "./support/fixtures";

/**
 * Subscription states in the console (desktop project), with
 * PAYMENT_PROVIDER=none: trial banner, a plan limit that disables creation
 * with the reason, an upgrade request, and its approval by the super admin
 * that lifts the limit. Works on a brand-new workspace.
 */
interface Entitlements {
  entitlements: {
    phase: string;
    planName: string | null;
    trialDaysRemaining: number | null;
    limits: { maxRestaurants: number | null };
  };
}

test("trial banner, a reached plan limit, and an upgrade approved by the super admin that lifts it", async ({
  newContext,
}) => {
  const owner = await newOwner("Upgrade");
  const ws = owner.workspaceId;
  const entitlements = async () =>
    (await data<Entitlements>(await owner.api.get(`/api/v1/workspaces/${ws}/entitlements`)))
      .entitlements;

  const start = await entitlements();
  expect(start.phase).toBe("TRIAL");
  const limit = start.limits.maxRestaurants!;
  expect(limit).toBeGreaterThan(0);
  // Fill the plan's restaurant allowance; the next one is refused by the server.
  for (let i = 1; i <= limit; i++) {
    await data(
      await owner.api.post(`/api/v1/workspaces/${ws}/restaurants`, {
        data: { name: `Outlet ${i}` },
      }),
    );
  }
  const over = await owner.api.post(`/api/v1/workspaces/${ws}/restaurants`, {
    data: { name: "One too many" },
  });
  expect(over.status()).toBe(402);
  expect(((await over.json()) as { error: { code: string } }).error.code).toBe("LIMIT_REACHED");

  const { context, page } = await newContext(null);
  await context.addCookies((await owner.api.storageState()).cookies);

  // Trial banner with the days the server computed.
  await page.goto(`/app/w/${ws}`);
  const days = start.trialDaysRemaining!;
  await expect(
    page.getByText(new RegExp(`${days} days? left\\s*in your free trial of ${start.planName}`)),
  ).toBeVisible();

  // The limit disables "Create restaurant" and says why.
  await page.goto(`/app/w/${ws}/restaurants`);
  const create = page.getByRole("button", { name: "Create restaurant" });
  await expect(create).toBeDisabled();
  const reason = `You've reached the ${limit}-restaurant limit of your plan. Upgrade to add more.`;
  await expect(create).toHaveAccessibleDescription(reason);
  await expect(page.getByText(reason).first()).toBeVisible();

  // Upgrade request (no payment gateway: our team is notified instead).
  await page.goto(`/app/w/${ws}/subscription`);
  await page.getByRole("button", { name: "Upgrade plan" }).click();
  const dialog = page.getByRole("dialog", { name: "Upgrade your plan" });
  await expect(dialog.getByText(/Online payment isn't available yet/)).toBeVisible();
  await dialog.getByRole("radio", { name: /Enterprise/ }).check();
  await dialog.getByRole("button", { name: "Send upgrade request" }).click();
  await expect(page.getByText(/Request for the Enterprise plan sent/)).toBeVisible();
  await expect(page.getByText(/Enterprise plan requested .* waiting for approval/)).toBeVisible();
  expect((await entitlements()).phase).toBe("TRIAL");

  // The super admin approves it in the admin console.
  const admin = await newContext("admin");
  await admin.page.goto(`${E2E_URLS.admin}/admin/upgrade-requests`);
  await admin.page
    .getByRole("searchbox", { name: "Search upgrade requests" })
    .fill(owner.workspaceName);
  await admin.page.getByRole("row", { name: `Open request from ${owner.workspaceName}` }).click();
  await admin.page.getByRole("button", { name: "Approve…" }).click();
  const approve = admin.page.getByRole("dialog", { name: "Approve upgrade to Enterprise?" });
  await approve.getByRole("button", { name: "Approve & activate" }).click();
  await expect(
    admin.page.getByText(`Enterprise plan activated for ${owner.workspaceName}`),
  ).toBeVisible();

  // The owner's limits changed: active Enterprise, restaurants unlimited, creation enabled.
  await expect.poll(async () => (await entitlements()).phase).toBe("ACTIVE");
  const after = await entitlements();
  expect(after.planName).toBe("Enterprise");
  expect(after.limits.maxRestaurants).toBeNull();
  // The workspace shell (banner) reads entitlements from the structure endpoint.
  const structure = await data<Entitlements>(
    await owner.api.get(`/api/v1/workspaces/${ws}/structure`),
  );
  expect(structure.entitlements.phase).toBe("ACTIVE");
  // A full reload restores the structure saved seconds ago; it must still be refetched.
  await page.goto(`/app/w/${ws}/restaurants`);
  await expect(page.getByRole("button", { name: "Create restaurant" })).toBeEnabled();
  await expect(page.getByText(reason)).toHaveCount(0);
  await expect(page.getByText(/left\s*in your free trial/)).toHaveCount(0);
  await data(
    await owner.api.post(`/api/v1/workspaces/${ws}/restaurants`, { data: { name: "Outlet 4" } }),
  );
  await owner.api.dispose();
});
