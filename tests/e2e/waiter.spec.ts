import type { Page } from "@playwright/test";

import {
  E2E_URLS,
  data,
  expect,
  freshTable,
  guestApi,
  ordersWithNote,
  placeGuestOrder,
  qrToken,
  test,
  transition,
  uniqueSuffix,
  type OrderLike,
} from "./support/fixtures";

/**
 * Waiter console on a phone (mobile project only), as the seeded waiter of the
 * Indiranagar branch. Each test works on a new table of its own.
 */

const waiterUrl = (branchId: string) => `${E2E_URLS.ops}/waiter/${branchId}`;

/** The waiter-console card of one order. */
function orderCard(page: Page, order: Pick<OrderLike, "orderNumber">) {
  return page.locator('[data-slot="card"]').filter({
    has: page.getByRole("button", { name: `Open order ${order.orderNumber} details` }),
  });
}

async function lane(page: Page, name: "New" | "Kitchen" | "Ready") {
  await page
    .getByRole("tablist", { name: "Order lanes" })
    .getByRole("tab", { name: new RegExp(`^${name}`) })
    .click();
}

test("waiter approves a QR order; after the kitchen marks it ready the waiter serves it", async ({
  newContext,
  ownerApi,
  demo,
}) => {
  const note = `approve-${uniqueSuffix()}`;
  const table = await freshTable(ownerApi, demo.branchId);
  const guest = await guestApi(await qrToken(ownerApi, table.branchId, table.id));
  const order = await placeGuestOrder(
    guest,
    [{ menuItemId: demo.items["Masala Chai"]!.id, quantity: 2 }],
    note,
  );
  await guest.dispose();

  const { page } = await newContext("waiter");
  await page.goto(waiterUrl(demo.branchId));
  const card = orderCard(page, order);
  await expect(card).toBeVisible();
  await expect(card.getByText("QR order")).toBeVisible();
  await card.getByRole("button", { name: "Accept" }).click();
  await expect(
    page.getByText(`Order #${order.orderNumber} accepted — sent to the kitchen`),
  ).toBeVisible();

  await lane(page, "Kitchen");
  await expect(orderCard(page, order)).toBeVisible();
  const [accepted] = await ordersWithNote(ownerApi, demo.branchId, note);
  expect(accepted!.status).toBe("ACCEPTED");

  // The kitchen (another device) finishes it.
  await transition(ownerApi, order.id, "start", "ready");
  await lane(page, "Ready");
  await orderCard(page, order).getByRole("button", { name: "Serve" }).click({ timeout: 20_000 });
  await expect(page.getByText(`Order #${order.orderNumber} served`)).toBeVisible();
  await expect
    .poll(async () => (await ordersWithNote(ownerApi, demo.branchId, note))[0]!.status)
    .toBe("SERVED");

  // History shows it for today.
  await page.getByRole("tab", { name: "History" }).click();
  await expect(page.getByText(`#${order.orderNumber}`).first()).toBeVisible();
});

test("waiter rejects a QR order with a reason and the guest is told why", async ({
  newContext,
  ownerApi,
  demo,
}) => {
  const note = `reject-${uniqueSuffix()}`;
  const table = await freshTable(ownerApi, demo.branchId);
  const token = await qrToken(ownerApi, table.branchId, table.id);

  const guest = await newContext(null);
  await guest.page.goto(`/t/${token}`);
  await guest.page.getByRole("button", { name: "Add Fresh Lime Soda", exact: true }).click();
  await guest.page.getByRole("button", { name: /View cart/ }).click();
  const cart = guest.page.getByRole("dialog", { name: "Your order" });
  await cart.getByLabel(/Special instructions/).fill(note);
  await cart.getByRole("button", { name: /^Place order/ }).click();
  await guest.page.getByRole("button", { name: "Track my order" }).click();
  const [order] = await ordersWithNote(ownerApi, demo.branchId, note);

  const waiter = await newContext("waiter");
  await waiter.page.goto(waiterUrl(demo.branchId));
  await orderCard(waiter.page, order!).getByRole("button", { name: "Reject" }).click();
  const dialog = waiter.page.getByRole("dialog", { name: `Reject order #${order!.orderNumber}?` });
  await dialog.getByRole("textbox").fill("Out of limes today");
  await dialog.getByRole("button", { name: "Reject order" }).click();
  await expect(waiter.page.getByText(`Order #${order!.orderNumber} rejected`)).toBeVisible();

  const guestOrder = guest.page.getByRole("article", { name: `Order ${order!.orderNumber}` });
  await expect(guestOrder.getByText("The restaurant couldn't accept this order")).toBeVisible({
    timeout: 15_000,
  });
  await expect(guestOrder.getByText("Out of limes today")).toBeVisible();
});

test("waiter enters an order for a table; it goes straight to the kitchen", async ({
  newContext,
  ownerApi,
  demo,
}) => {
  const note = `staff-${uniqueSuffix()}`;
  const table = await freshTable(ownerApi, demo.branchId);
  const { page } = await newContext("waiter");
  await page.goto(waiterUrl(demo.branchId));
  await page.getByRole("tab", { name: "Tables" }).click();
  await page.getByRole("button", { name: new RegExp(`^${table.name}:`) }).click();
  await page.getByRole("button", { name: "Add items" }).click();
  const dialog = page.getByRole("dialog", { name: `Add items · ${table.name}` });
  await dialog.getByRole("searchbox", { name: "Search dishes" }).fill("naan");
  await dialog.getByRole("button", { name: /Butter Naan/ }).click();
  // Butter Naan has add-ons, so its options open first.
  await dialog.getByRole("button", { name: "Add · ₹69.00" }).click();
  await dialog.getByLabel("Instructions").fill(note);
  await dialog.getByRole("button", { name: "Send order" }).click();

  await expect
    .poll(async () => (await ordersWithNote(ownerApi, demo.branchId, note)).map((o) => o.status))
    .toEqual(["ACCEPTED"]);
  const drawer = page.getByRole("dialog", { name: table.name });
  await expect(drawer.getByText(/Butter Naan/).first()).toBeVisible();
  await expect(drawer.getByText("Not sent — will send when online")).toHaveCount(0);
});

test("a guest's bill request shows up under Bill requests", async ({
  newContext,
  ownerApi,
  demo,
}) => {
  const table = await freshTable(ownerApi, demo.branchId);
  const guest = await guestApi(await qrToken(ownerApi, table.branchId, table.id));
  const order = await placeGuestOrder(guest, [
    { menuItemId: demo.items["Masala Chai"]!.id, quantity: 1 },
  ]);
  await transition(ownerApi, order.id, "accept", "start", "ready", "serve");
  await data(await guest.post("/api/v1/public/session/bill-request"));
  await guest.dispose();

  const { page } = await newContext("waiter");
  await page.goto(waiterUrl(demo.branchId));
  await page.getByRole("tab", { name: /Bill requests/ }).click();
  await expect(
    page.getByRole("tabpanel").getByText(table.name, { exact: true }).first(),
  ).toBeVisible();
});
