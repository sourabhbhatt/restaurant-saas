import type { APIRequestContext, Locator, Page } from "@playwright/test";

import {
  E2E_URLS,
  data,
  expect,
  freshTable,
  guestApi,
  issueBill,
  ordersWithNote,
  placeGuestOrder,
  qrToken,
  test,
  transition,
  uniqueSuffix,
  type BillLike,
  type DemoData,
  type FreshTable,
  type OrderLike,
} from "./support/fixtures";

/**
 * Kitchen, cashier and multi-device staff flows (desktop project only) on the
 * seeded Indiranagar branch. Each test works on a new table of its own.
 */

const ops = (path: string) => `${E2E_URLS.ops}${path}`;

async function guestOrderOn(
  ownerApi: APIRequestContext,
  demo: DemoData,
  table: FreshTable,
  items: [string, number][],
  note: string,
): Promise<OrderLike> {
  const guest = await guestApi(await qrToken(ownerApi, table.branchId, table.id));
  const placed = await placeGuestOrder(
    guest,
    items.map(([name, quantity]) => ({ menuItemId: demo.items[name]!.id, quantity })),
    note,
  );
  await guest.dispose();
  // The staff view (version, session) of the new order.
  return data<OrderLike>(await ownerApi.get(`/api/v1/orders/${placed.id}`));
}

function waiterCard(scope: Page | Locator, order: Pick<OrderLike, "orderNumber">) {
  const page = "page" in scope ? scope.page() : scope;
  return scope.locator('[data-slot="card"]').filter({
    has: page.getByRole("button", { name: `Open order ${order.orderNumber} details` }),
  });
}

test("kitchen starts a ticket, marks items ready and the waiter sees it ready", async ({
  newContext,
  ownerApi,
  demo,
}) => {
  const note = `kds-${uniqueSuffix()}`;
  const table = await freshTable(ownerApi, demo.branchId);
  const order = await guestOrderOn(
    ownerApi,
    demo,
    table,
    [
      ["Paneer Tikka", 1],
      ["Masala Chai", 2],
    ],
    note,
  );
  await transition(ownerApi, order.id, "accept");

  const kitchen = await newContext("kitchen");
  await kitchen.page.goto(ops(`/kitchen/${demo.branchId}`));
  const ticket = kitchen.page.getByRole("article", {
    name: `Order ${order.orderNumber}, ${table.name}`,
  });
  await expect(ticket).toBeVisible();
  await expect(ticket.getByText(note)).toBeVisible();

  await ticket.getByRole("button", { name: "Start" }).click();
  await expect
    .poll(async () => (await ordersWithNote(ownerApi, demo.branchId, note))[0]!.status)
    .toBe("PREPARING");

  // Item-level progress: each tap moves an item one step towards ready.
  // Once every line is ready the ticket stops offering item toggles.
  for (const item of ["1 Paneer Tikka", "2 Masala Chai"]) {
    const toggle = ticket.getByRole("button", { name: new RegExp(`^${item}: `) });
    for (;;) {
      const label = (await toggle.count()) ? await toggle.getAttribute("aria-label") : null;
      if (!label || / ready\. /.test(label)) break;
      await toggle.click();
      await expect(toggle.and(ticket.getByRole("button", { name: label }))).toHaveCount(0);
    }
  }
  await expect
    .poll(async () =>
      (await ordersWithNote(ownerApi, demo.branchId, note))[0]!.items.map((i) => i.status),
    )
    .toEqual(["READY", "READY"]);
  // The last ready line makes the order itself READY on the server.
  await expect
    .poll(async () => (await ordersWithNote(ownerApi, demo.branchId, note))[0]!.status)
    .toBe("READY");
  await expect(ticket.getByText("Waiting for pickup")).toBeVisible();

  const waiter = await newContext("waiter");
  await waiter.page.goto(ops(`/waiter/${demo.branchId}`));
  const ready = waiter.page.getByRole("region", { name: "Ready to serve" });
  await expect(waiterCard(ready, order).getByRole("button", { name: "Serve" })).toBeVisible();
});

test("cashier bills a table, takes a partial UPI payment and settles the rest in cash", async ({
  newContext,
  ownerApi,
  demo,
}) => {
  const note = `cash-${uniqueSuffix()}`;
  const table = await freshTable(ownerApi, demo.branchId);
  const order = await guestOrderOn(ownerApi, demo, table, [["Paneer Tikka", 1]], note);
  await transition(ownerApi, order.id, "accept", "start", "ready", "serve");

  const { page } = await newContext("cashier");
  await page.goto(ops(`/cashier/${demo.branchId}`));
  const queue = page.getByRole("complementary", { name: "Cashier queue" });
  await queue
    .getByRole("region", { name: "Awaiting bill" })
    .getByRole("button", { name: new RegExp(`^${table.name} `) })
    .click();
  const selected = page.getByRole("region", { name: "Selected bill" });
  await selected.getByRole("button", { name: "Generate bill" }).click();
  await expect(page.getByText(new RegExp(`Bill #\\d+ issued for ${table.name}`))).toBeVisible();

  // ₹289.00 + CGST ₹7.23 + SGST ₹7.23 (each rounded) = ₹303.46. Pay ₹200 by UPI first.
  const form = page.getByRole("form", { name: "Record payment" });
  await form.getByRole("button", { name: "UPI", exact: true }).click();
  await form.getByLabel(/^Amount/).fill("200");
  await form.getByRole("button", { name: "Record ₹200.00 · UPI" }).click();
  await expect(page.getByText(/₹200\.00 recorded · Partially paid/)).toBeVisible();

  const list = await data<{ items: BillLike[] }>(
    await ownerApi.get(`/api/v1/branches/${demo.branchId}/bills`, { params: { pageSize: 100 } }),
  );
  const billed = list.items.find((b) => b.sessionId === order.sessionId);
  expect(billed!.paymentStatus).toBe("PARTIALLY_PAID");
  expect(billed!.balanceDue).toBe(10346);

  // The rest in cash with ₹500 tendered: the change is shown.
  await form.getByRole("button", { name: "Cash", exact: true }).click();
  await form.getByRole("button", { name: /^Full balance/ }).click();
  await form.getByLabel("Cash tendered").fill("500");
  await form.getByRole("button", { name: "Record ₹103.46 · Cash" }).click();
  await expect(page.getByText(/₹103\.46 recorded · Paid · Change ₹396\.54/)).toBeVisible();

  await page.getByRole("button", { name: "Close table" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Close table" }).click();
  await expect
    .poll(async () => {
      const s = await data<{ tables: { tableId: string; session: unknown }[] }>(
        await ownerApi.get(`/api/v1/branches/${demo.branchId}/sessions`),
      );
      return s.tables.find((t) => t.tableId === table.id)?.session ?? null;
    })
    .toBeNull();

  // The day's payment summary counts both methods.
  const bill = await data<BillLike & { payments: { method: string; amount: number }[] }>(
    await ownerApi.get(`/api/v1/bills/${billed!.id}`),
  );
  expect(bill.paymentStatus).toBe("PAID");
  expect(bill.payments.map((p) => [p.method, p.amount])).toEqual([
    ["UPI", 20000],
    ["CASH", 10346],
  ]);
});

test("two waiters act on the same order: the slower one is told it was already handled", async ({
  newContext,
  ownerApi,
  demo,
}) => {
  const note = `race-${uniqueSuffix()}`;
  const table = await freshTable(ownerApi, demo.branchId);
  const order = await guestOrderOn(ownerApi, demo, table, [["Masala Chai", 1]], note);

  const first = await newContext("waiter");
  // page.route() does not see requests the service worker makes (GET /api/* goes through
  // its NetworkOnly route once it controls the page), so this device runs without one.
  const second = await newContext("manager", { serviceWorkers: "block" });
  // The second device's screen does not refresh (no live events, list answers frozen at
  // their first response), like a phone whose last refresh came just before the other accept.
  const branchApi = (suffix: string) => (url: URL) =>
    url.pathname === `/api/v1/branches/${demo.branchId}/${suffix}`;
  await second.page.route(branchApi("events"), (r) => r.fulfill({ status: 204 }));
  const frozen = new Map<string, string>();
  await second.page.route(branchApi("orders"), async (r) => {
    if (r.request().method() !== "GET") return r.fallback();
    const url = r.request().url();
    if (!frozen.has(url)) frozen.set(url, await (await r.fetch()).text());
    await r.fulfill({ status: 200, contentType: "application/json", body: frozen.get(url) });
  });
  for (const p of [first.page, second.page]) {
    await p.goto(ops(`/waiter/${demo.branchId}`));
    await expect(waiterCard(p, order).getByRole("button", { name: "Accept" })).toBeEnabled();
  }

  await waiterCard(first.page, order).getByRole("button", { name: "Accept" }).click();
  await expect(
    first.page.getByText(`Order #${order.orderNumber} accepted — sent to the kitchen`),
  ).toBeVisible();

  await waiterCard(second.page, order).getByRole("button", { name: "Accept" }).click();
  await expect(
    second.page.getByText(`Order #${order.orderNumber} was already handled`),
  ).toBeVisible();

  const [after] = await ordersWithNote(ownerApi, demo.branchId, note);
  expect(after!.status).toBe("ACCEPTED");
  expect(after!.version).toBe(order.version + 1);

  // Over the API the stale write is a 409, never a 500.
  const stale = await ownerApi.post(`/api/v1/orders/${order.id}/transition`, {
    data: { action: "accept", expectedVersion: order.version },
  });
  expect(stale.status()).toBe(409);
});

test("order history, table sessions and the bills list agree in the dashboard", async ({
  page,
  context,
  ownerApi,
  demo,
}) => {
  const note = `history-${uniqueSuffix()}`;
  const table = await freshTable(ownerApi, demo.branchId);
  const order = await guestOrderOn(ownerApi, demo, table, [["Gulab Jamun", 1]], note);
  await transition(ownerApi, order.id, "accept", "start", "ready", "serve");
  await context.addCookies((await ownerApi.storageState()).cookies);

  await page.goto(`/app/b/${demo.branchId}/tables`);
  const row = page
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: `${table.name} actions` }) });
  await expect(row).not.toContainText("Available");

  await page.goto(`/app/b/${demo.branchId}/orders`);
  await expect(page.getByText(`#${order.orderNumber}`).first()).toBeVisible();

  const bill = await issueBill(ownerApi, demo.branchId, order.sessionId);
  await page.goto(`/app/b/${demo.branchId}/bills`);
  await expect(page.getByText(`#${bill.billNumber}`).first()).toBeVisible();
});

test("ops consoles link back to the dashboard on the console app, not to a missing ops page", async ({
  newContext,
  demo,
}) => {
  const { page } = await newContext("manager");
  for (const path of [`/waiter/${demo.branchId}`, `/kitchen/${demo.branchId}`]) {
    await page.goto(ops(path));
    const back = page.getByRole("link", { name: "Back to branch dashboard" });
    await expect(back).toHaveAttribute("href", `${E2E_URLS.console}/app/b/${demo.branchId}`);
  }
});
