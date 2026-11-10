import {
  E2E_URLS,
  NEW_ACCOUNT_PASSWORD,
  apiClient,
  data,
  expect,
  latestEmailTo,
  test,
  uniqueSuffix,
} from "./support/fixtures";

/**
 * Staff invitations end to end (desktop project): the demo owner invites a
 * kitchen cook to the Indiranagar branch, the link arrives by email (outbox,
 * read through the dev mailbox), the cook creates an account and joins, then
 * signs in on the ops app and gets exactly the kitchen screen.
 */
test("owner invites a cook; the cook joins from the emailed link and gets the kitchen screen only", async ({
  newContext,
  demo,
}) => {
  const email = `cook-${uniqueSuffix()}@e2e.test`;

  // The owner sends the invitation from the members page.
  const owner = await newContext("owner");
  await owner.page.goto(`/app/w/${demo.workspaceId}/members`);
  await owner.page.getByRole("tab", { name: "Invitations" }).click();
  await owner.page.getByLabel("Email").fill(email);
  await owner.page.getByLabel("Workspace role").selectOption({ label: "Member" });
  await owner.page.getByLabel("Restaurant (optional)").selectOption({ label: "Saffron Table" });
  await owner.page
    .getByRole("combobox", { name: "Branch", exact: true })
    .selectOption({ label: "Indiranagar" });
  await owner.page.getByLabel("Role there").selectOption({ label: "Kitchen Staff" });
  await owner.page.getByRole("button", { name: "Send invitation" }).click();
  await expect(owner.page.getByRole("button", { name: "Copy link" })).toBeVisible();
  const shownLink = (await owner.page
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
  await expect(cook.page.getByText("Join Demo Hospitality Group")).toBeVisible();
  await expect(cook.page.getByText(/Kitchen Staff at Indiranagar/)).toBeVisible();
  await cook.page.getByRole("link", { name: "Create an account" }).click();
  await cook.page.getByLabel("Full name").fill("Kavya Cook");
  await cook.page.getByLabel("Work email").fill(email);
  await cook.page.getByRole("textbox", { name: "Password" }).fill(NEW_ACCOUNT_PASSWORD);
  await cook.page.getByRole("checkbox").check();
  await cook.page.getByRole("button", { name: "Create account" }).click();
  await expect(cook.page).toHaveURL(new RegExp(`${invitePath}$`));
  await cook.page.getByRole("button", { name: "Accept and join Demo Hospitality Group" }).click();
  await expect(cook.page).toHaveURL(new RegExp(`/app/b/${demo.branchId}`));

  // The owner sees the invitation accepted.
  await owner.page.reload();
  await owner.page.getByRole("tab", { name: "Invitations" }).click();
  // Invitation row: [email, role line] + status badge.
  const row = owner.page.getByText(email, { exact: true }).locator("xpath=../..");
  await expect(row).toContainText("Member · Kitchen Staff at Indiranagar");
  await expect(row).toContainText("Accepted");
  const ownerApi = await apiClient(await owner.context.storageState());
  const invitations = await data<
    { email: string; status: string; workspaceRole: { id: string } }[]
  >(await ownerApi.get(`/api/v1/workspaces/${demo.workspaceId}/invitations`));
  const accepted = invitations.find((i) => i.email === email);
  expect(accepted?.status).toBe("ACCEPTED");
  await ownerApi.dispose();

  // On another device the cook signs in to the ops app.
  const tablet = await newContext(null);
  await tablet.page.goto(
    `${E2E_URLS.ops}/sign-in?next=${encodeURIComponent(`/kitchen/${demo.branchId}`)}`,
  );
  await tablet.page.getByLabel("Email").fill(email);
  await tablet.page.getByRole("textbox", { name: "Password" }).fill(NEW_ACCOUNT_PASSWORD);
  await tablet.page.getByRole("button", { name: "Sign in" }).click();
  await expect(tablet.page).toHaveURL(new RegExp(`/kitchen/${demo.branchId}`));
  await expect(tablet.page.getByText("Indiranagar · Kitchen")).toBeVisible();

  // Kitchen Staff has no orders.view: the waiter console refuses, and so does the API.
  await tablet.page.goto(`${E2E_URLS.ops}/waiter/${demo.branchId}`);
  await expect(
    tablet.page.getByRole("heading", { name: "Waiter console unavailable" }),
  ).toBeVisible();
  await expect(
    tablet.page.getByText("Your role at this branch does not include viewing orders."),
  ).toBeVisible();
  const cookApi = await apiClient(await tablet.context.storageState());
  const orders = await cookApi.get(`/api/v1/branches/${demo.branchId}/orders`);
  expect(orders.status()).toBe(403);
  const kitchen = await cookApi.get(`/api/v1/branches/${demo.branchId}/kitchen`);
  expect(kitchen.status()).toBe(200);
  // Nor can the cook invite anyone (a valid request the owner could send).
  const invite = await cookApi.post(`/api/v1/workspaces/${demo.workspaceId}/invitations`, {
    data: { email: `x-${uniqueSuffix()}@e2e.test`, workspaceRoleId: accepted!.workspaceRole.id },
  });
  expect(invite.status()).toBe(403);
  await cookApi.dispose();
});
