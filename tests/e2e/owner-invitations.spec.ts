import {
  E2E_URLS,
  NEW_ACCOUNT_PASSWORD,
  apiClient,
  data,
  expect,
  latestEmailTo,
  newOwner,
  test,
  uniqueSuffix,
} from "./support/fixtures";

/**
 * Staff invitations end to end (desktop project): a new owner invites a
 * kitchen cook to one branch, the link arrives by email (outbox, read through
 * the dev mailbox on the local API, so this journey needs the local E2E
 * stack), the cook creates an account and joins, then signs in on the ops app
 * and gets exactly the kitchen screen. A brand-new owner, so the demo
 * workspace never gains members.
 */
test("owner invites a cook; the cook joins from the emailed link and gets the kitchen screen only", async ({
  newContext,
}) => {
  const owner = await newOwner("Invites");
  const ws = owner.workspaceId;
  const suffix = uniqueSuffix();
  const restaurant = await data<{ id: string; name: string }>(
    await owner.api.post(`/api/v1/workspaces/${ws}/restaurants`, {
      data: { name: `Dosa House ${suffix}` },
    }),
  );
  const branch = await data<{ id: string; name: string }>(
    await owner.api.post(`/api/v1/restaurants/${restaurant.id}/branches`, {
      data: { name: `Jayanagar ${suffix}`, city: "Bengaluru" },
    }),
  );
  const email = `cook-${suffix}@e2e.test`;

  // The owner sends the invitation from the members page.
  const { context: ownerContext, page } = await newContext(null);
  await ownerContext.addCookies((await owner.api.storageState()).cookies);
  await page.goto(`/app/w/${ws}/members`);
  await page.getByRole("tab", { name: "Invitations" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Workspace role").selectOption({ label: "Member" });
  await page.getByLabel("Restaurant (optional)").selectOption({ label: restaurant.name });
  await page
    .getByRole("combobox", { name: "Branch", exact: true })
    .selectOption({ label: branch.name });
  await page.getByLabel("Role there").selectOption({ label: "Kitchen Staff" });
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  const shownLink = (await page
    .getByText(/\/invite\//)
    .first()
    .textContent())!.trim();

  // The same link arrives by email.
  const mail = await latestEmailTo(email);
  const emailedLink = /https?:\/\/\S+\/invite\/[A-Za-z0-9_-]+/.exec(mail.text)?.[0];
  expect(emailedLink, `invite link in: ${mail.text}`).toBeDefined();
  expect(emailedLink).toBe(shownLink);
  const invitePath = new URL(emailedLink!).pathname;

  // The cook opens it, creates an account (sign-up returns to the invitation) and joins.
  const cook = await newContext(null);
  await cook.page.goto(invitePath);
  await expect(cook.page.getByText(`Join ${owner.workspaceName}`)).toBeVisible();
  await expect(cook.page.getByText(`Kitchen Staff at ${branch.name}`)).toBeVisible();
  await cook.page.getByRole("link", { name: "Create an account" }).click();
  await cook.page.getByLabel("Full name").fill("Kavya Cook");
  await cook.page.getByLabel("Work email").fill(email);
  await cook.page.getByRole("textbox", { name: "Password" }).fill(NEW_ACCOUNT_PASSWORD);
  await cook.page.getByRole("checkbox").check();
  await cook.page.getByRole("button", { name: "Create account" }).click();
  await expect(cook.page).toHaveURL(new RegExp(`${invitePath}$`));
  await cook.page.getByRole("button", { name: `Accept and join ${owner.workspaceName}` }).click();
  await expect(cook.page).toHaveURL(new RegExp(`/app/b/${branch.id}`));

  // The owner sees the invitation accepted.
  await page.reload();
  await page.getByRole("tab", { name: "Invitations" }).click();
  // Invitation row: [email, role line] + status badge (the list has no row role yet).
  const row = page.getByText(email, { exact: true }).locator("xpath=../..");
  await expect(row).toContainText(`Member · Kitchen Staff at ${branch.name}`);
  await expect(row).toContainText("Accepted");
  const invitations = await data<
    { email: string; status: string; workspaceRole: { id: string } }[]
  >(await owner.api.get(`/api/v1/workspaces/${ws}/invitations`));
  const accepted = invitations.find((i) => i.email === email);
  expect(accepted?.status).toBe("ACCEPTED");

  // On another device the cook signs in to the ops app.
  const tablet = await newContext(null);
  await tablet.page.goto(
    `${E2E_URLS.ops}/sign-in?next=${encodeURIComponent(`/kitchen/${branch.id}`)}`,
  );
  await tablet.page.getByLabel("Email").fill(email);
  await tablet.page.getByRole("textbox", { name: "Password" }).fill(NEW_ACCOUNT_PASSWORD);
  await tablet.page.getByRole("button", { name: "Sign in" }).click();
  await expect(tablet.page).toHaveURL(new RegExp(`/kitchen/${branch.id}`));
  await expect(tablet.page.getByText(`${branch.name} · Kitchen`)).toBeVisible();

  // Kitchen Staff has no orders.view: the waiter console refuses, and so does the API.
  await tablet.page.goto(`${E2E_URLS.ops}/waiter/${branch.id}`);
  await expect(
    tablet.page.getByRole("heading", { name: "Waiter console unavailable" }),
  ).toBeVisible();
  await expect(
    tablet.page.getByText("Your role at this branch does not include viewing orders."),
  ).toBeVisible();
  const cookApi = await apiClient(await tablet.context.storageState());
  expect((await cookApi.get(`/api/v1/branches/${branch.id}/orders`)).status()).toBe(403);
  expect((await cookApi.get(`/api/v1/branches/${branch.id}/kitchen`)).status()).toBe(200);
  // Nor can the cook invite anyone (a valid request the owner could send).
  const invite = await cookApi.post(`/api/v1/workspaces/${ws}/invitations`, {
    data: { email: `x-${uniqueSuffix()}@e2e.test`, workspaceRoleId: accepted!.workspaceRole.id },
  });
  expect(invite.status()).toBe(403);
  await cookApi.dispose();
  await owner.api.dispose();
});
