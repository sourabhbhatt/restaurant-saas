import type { Page } from "@playwright/test";

import {
  data,
  expect,
  freshTable,
  issueBill,
  ordersWithNote,
  qrToken,
  settleAndClose,
  test,
  transition,
  uniqueSuffix,
  type OrderLike,
} from "./support/fixtures";

/**
 * Guest QR ordering on a phone (mobile project only). Each test uses a new
 * table of its own in the seeded Koramangala branch, so tests run in parallel
 * and a repeat or retry never meets an earlier attempt's session.
 */

async function openTable(page: Page, token: string) {
  await page.goto(`/t/${token}`);
  await expect(page.getByRole("heading", { level: 1, name: "Saffron Table" })).toBeVisible();
}

async function quickAdd(page: Page, item: string) {
  await page.getByRole("button", { name: `Add ${item}`, exact: true }).click();
}

async function placeOrder(page: Page, note?: string) {
  await page.getByRole("button", { name: /View cart/ }).click();
  const cart = page.getByRole("dialog", { name: "Your order" });
  if (note) await cart.getByLabel(/Special instructions/).fill(note);
  await cart.getByRole("button", { name: /^Place order/ }).click();
  return cart;
}

test("guest browses, customises a dish, orders and orders again", async ({
  page,
  ownerApi,
  demo,
}) => {
  const table = await freshTable(ownerApi, demo.otherBranchId);
  const token = await qrToken(ownerApi, table.branchId, table.id);
  const note = `guest-${uniqueSuffix()}`;
  await openTable(page, token);
  await expect(page.getByText(`Table ${table.name} · Koramangala`)).toBeVisible();

  // Search narrows the menu.
  await page.getByRole("searchbox", { name: "Search the menu" }).fill("tikka");
  await expect(page.getByRole("heading", { name: "Paneer Tikka", level: 3 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Butter Chicken", level: 3 })).toHaveCount(0);

  // Customise: an add-on and a second portion.
  await page.getByRole("button", { name: "Customize Paneer Tikka" }).click();
  const sheet = page.getByRole("dialog", { name: /Paneer Tikka/ });
  await sheet.getByLabel(/Extra Cheese/).check();
  await sheet.getByRole("button", { name: "Increase quantity of Paneer Tikka" }).click();
  // (289 + 40) × 2
  await sheet.getByRole("button", { name: /Add to order\s*₹658\.00/ }).click();
  await expect(page.getByRole("button", { name: "Open cart, 2 items" })).toBeVisible();

  const cart = await placeOrder(page, note);
  await expect(cart.getByText("Paneer Tikka")).toHaveCount(0);
  const placed = page.getByRole("dialog", { name: /Order #\d+ sent!/ });
  await expect(placed).toBeVisible();
  await placed.getByRole("button", { name: "Add more items" }).click();

  // The server priced it (add-on included) and holds exactly one order.
  const [first] = await ordersWithNote(ownerApi, demo.otherBranchId, note);
  expect(first).toBeDefined();
  expect(first!.status).toBe("PENDING");
  expect(first!.items).toEqual([
    expect.objectContaining({ itemName: "Paneer Tikka", quantity: 2 }),
  ]);
  const detail = await data<{ subtotal: number }>(
    await ownerApi.get(`/api/v1/orders/${first!.id}`),
  );
  expect(detail.subtotal).toBe(65800);

  // Repeat order in the same table session.
  await page.getByRole("searchbox", { name: "Search the menu" }).fill("");
  await quickAdd(page, "Masala Chai");
  await placeOrder(page, note);
  await page.getByRole("button", { name: "Track my order" }).click();
  const mine = page.getByRole("list", { name: "Your orders" });
  await expect(mine.getByRole("article")).toHaveCount(2);
  await expect(mine.getByRole("article", { name: `Order ${first!.orderNumber}` })).toBeVisible();

  const both = await ordersWithNote(ownerApi, demo.otherBranchId, note);
  expect(both).toHaveLength(2);
  expect(new Set(both.map((o) => o.sessionId)).size).toBe(1);
});

test("two guests share one table session and its bill; each sees only their own orders", async ({
  page,
  newContext,
  ownerApi,
  demo,
}) => {
  const table = await freshTable(ownerApi, demo.otherBranchId);
  const token = await qrToken(ownerApi, table.branchId, table.id);
  const note = `shared-${uniqueSuffix()}`;
  const second = await newContext(null);

  await openTable(page, token);
  await quickAdd(page, "Mango Lassi");
  await placeOrder(page, note);
  await page.getByRole("button", { name: "Track my order" }).click();

  await openTable(second.page, token);
  await quickAdd(second.page, "Gulab Jamun");
  await placeOrder(second.page, note);
  await second.page.getByRole("button", { name: "Track my order" }).click();

  const orders = await ordersWithNote(ownerApi, demo.otherBranchId, note);
  expect(orders).toHaveLength(2);
  expect(orders[0]!.sessionId).toBe(orders[1]!.sessionId);
  const mine = (p: Page) => p.getByRole("list", { name: "Your orders" }).getByRole("article");
  await expect(mine(page)).toHaveCount(1);
  await expect(mine(second.page)).toHaveCount(1);
  await expect(mine(page).getByText("Mango Lassi")).toBeVisible();
  await expect(mine(second.page).getByText("Gulab Jamun")).toBeVisible();

  // The second guest asks for the bill; staff see it on the table.
  await second.page.getByRole("button", { name: "Request the bill" }).click();
  await second.page.getByRole("alertdialog").getByRole("button", { name: "Request bill" }).click();
  await expect(second.page.getByText("Bill requested").first()).toBeVisible();
  await expect
    .poll(async () => {
      const s = await data<{ tables: { tableId: string; status: string }[] }>(
        await ownerApi.get(`/api/v1/branches/${demo.otherBranchId}/sessions`),
      );
      return s.tables.find((t) => t.tableId === table.id)?.status;
    })
    .toBe("BILL_REQUESTED");

  // Staff serve both orders and issue one bill; both phones show it.
  for (const o of orders) await transition(ownerApi, o.id, "accept", "start", "ready", "serve");
  const bill = await issueBill(ownerApi, demo.otherBranchId, orders[0]!.sessionId);
  for (const p of [page, second.page]) {
    await p.getByRole("button", { name: /^Bill/ }).click();
    const view = p.getByRole("article", { name: `Bill ${bill.billNumber}` });
    await expect(view).toBeVisible({ timeout: 15_000 });
    await expect(view.getByRole("row", { name: /Mango Lassi/ })).toBeVisible();
    await expect(view.getByRole("row", { name: /Gulab Jamun/ })).toBeVisible();
    // ₹258 + 2.5% CGST + 2.5% SGST
    await expect(view.getByText("₹270.90").first()).toBeVisible();
  }

  // Paid and closed: both guests are told the session ended.
  await settleAndClose(ownerApi, demo.otherBranchId, bill.id);
  for (const p of [page, second.page]) {
    await p.getByRole("button", { name: "My orders" }).click();
    await expect(p.getByText("This table session has ended.")).toBeVisible({ timeout: 15_000 });
  }
});

test("an invalid or replaced QR code explains itself and offers no ordering", async ({
  page,
  ownerApi,
  demo,
}) => {
  await page.goto("/t/this-is-not-a-real-qr-token-000000000000");
  await expect(page.getByRole("heading", { name: "This QR code isn't working" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Place order/ })).toHaveCount(0);

  // Regenerating a table's QR code retires the old one.
  const tableId = (await freshTable(ownerApi, demo.otherBranchId)).id;
  const oldToken = await qrToken(ownerApi, demo.otherBranchId, tableId);
  await openTable(page, oldToken);
  await data(await ownerApi.post(`/api/v1/tables/${tableId}/qr`, { data: {} }));
  await page.reload();
  await expect(page.getByRole("heading", { name: "This QR code isn't working" })).toBeVisible();

  const newToken = await qrToken(ownerApi, demo.otherBranchId, tableId);
  expect(newToken).not.toBe(oldToken);
  await openTable(page, newToken);
});

test("a guest whose table session cookie is gone re-joins instead of failing", async ({
  page,
  context,
  ownerApi,
  demo,
}) => {
  const table = await freshTable(ownerApi, demo.otherBranchId);
  const token = await qrToken(ownerApi, table.branchId, table.id);
  const note = `rejoin-${uniqueSuffix()}`;
  await openTable(page, token);
  await quickAdd(page, "Fresh Lime Soda");
  await placeOrder(page, note);
  await page.getByRole("button", { name: "Track my order" }).click();

  // Session cookie lost (cleared, expired or another browser profile).
  await context.clearCookies();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Saffron Table" })).toBeVisible();
  await page.getByRole("button", { name: "Menu" }).click();
  await quickAdd(page, "Masala Chai");
  await placeOrder(page, note);
  await expect(page.getByRole("dialog", { name: /Order #\d+ sent!/ })).toBeVisible();

  const orders = await ordersWithNote(ownerApi, demo.otherBranchId, note);
  expect(orders).toHaveLength(2);
  expect(orders[0]!.sessionId).toBe(orders[1]!.sessionId);
});

test.describe("network failure while sending an order", () => {
  test("offline: the order is not sent, the cart is kept, and Retry sends it once", async ({
    page,
    context,
    ownerApi,
    demo,
  }) => {
    const table = await freshTable(ownerApi, demo.otherBranchId);
    const token = await qrToken(ownerApi, table.branchId, table.id);
    const note = `offline-${uniqueSuffix()}`;
    await openTable(page, token);
    await quickAdd(page, "Masala Chai");
    await page.getByRole("button", { name: /View cart/ }).click();
    const cart = page.getByRole("dialog", { name: "Your order" });
    await cart.getByLabel(/Special instructions/).fill(note);

    await context.setOffline(true);
    await cart.getByRole("button", { name: /^Place order/ }).click();
    await expect(cart.getByText("You're offline — your order hasn't been sent")).toBeVisible();
    await expect(page.getByRole("dialog", { name: /sent!/ })).toHaveCount(0);
    expect(await ordersWithNote(ownerApi, demo.otherBranchId, note)).toHaveLength(0);

    await context.setOffline(false);
    await cart.getByRole("button", { name: "Retry sending order" }).click();
    await expect(page.getByRole("dialog", { name: /Order #\d+ sent!/ })).toBeVisible();
    expect(await ordersWithNote(ownerApi, demo.otherBranchId, note)).toHaveLength(1);
  });

  test("lost response: the retry replays the same order instead of duplicating it", async ({
    page,
    ownerApi,
    demo,
  }) => {
    const table = await freshTable(ownerApi, demo.otherBranchId);
    const token = await qrToken(ownerApi, table.branchId, table.id);
    const note = `lost-${uniqueSuffix()}`;
    await openTable(page, token);
    await quickAdd(page, "Masala Chai");
    await page.getByRole("button", { name: /View cart/ }).click();
    const cart = page.getByRole("dialog", { name: "Your order" });
    await cart.getByLabel(/Special instructions/).fill(note);

    // The request reaches the server, but the answer never reaches the phone.
    let reached = 0;
    await page.route("**/api/v1/public/session/orders", async (route) => {
      reached++;
      await route.fetch();
      await route.abort("connectionreset");
    });
    await cart.getByRole("button", { name: /^Place order/ }).click();
    await expect(cart.getByText("your order hasn't been sent")).toBeVisible();
    expect(reached).toBe(1);
    expect(await ordersWithNote(ownerApi, demo.otherBranchId, note)).toHaveLength(1);

    await page.unroute("**/api/v1/public/session/orders");
    await cart.getByRole("button", { name: "Retry sending order" }).click();
    const placed = page.getByRole("dialog", { name: /Order #\d+ sent!/ });
    await expect(placed).toBeVisible();

    const orders: OrderLike[] = await ordersWithNote(ownerApi, demo.otherBranchId, note);
    expect(orders).toHaveLength(1);
    await expect(placed).toHaveAccessibleName(`Order #${orders[0]!.orderNumber} sent!`);
  });
});
