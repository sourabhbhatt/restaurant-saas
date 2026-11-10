import type { APIRequestContext, Page } from "@playwright/test";

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
  serviceWorkerReady,
  test,
  transition,
  uniqueSuffix,
  type FreshTable,
  type OrderLike,
} from "./support/fixtures";

/**
 * Offline-first staff flows against production builds (service worker on), in
 * the ops app, on the seeded Indiranagar branch (desktop project only). Every
 * test works on a table of its own and finds its orders by a unique note.
 */

const ops = (path: string) => `${E2E_URLS.ops}${path}`;

async function openOps(page: Page, path: string) {
  await page.goto(ops(path));
  // Static chunks must be cached before the network goes away.
  await serviceWorkerReady(page);
}

async function composeStaffOrder(page: Page, table: string, item: RegExp) {
  await page.getByRole("tab", { name: "Tables" }).click();
  await page.getByRole("button", { name: new RegExp(`^${table}:`) }).click();
  await page.getByRole("button", { name: "Add items" }).click();
  const dialog = page.getByRole("dialog", { name: new RegExp(`Add items · ${table}`) });
  await expect(dialog.getByRole("button", { name: item })).toBeVisible();
  return dialog;
}

/** A guest order on `table`, already accepted (on the kitchen screen). */
async function acceptedGuestOrder(
  ownerApi: APIRequestContext,
  table: FreshTable,
  menuItemId: string,
  note: string,
  accept = true,
): Promise<OrderLike> {
  const guest = await guestApi(await qrToken(ownerApi, table.branchId, table.id));
  const placed = await placeGuestOrder(guest, [{ menuItemId, quantity: 1 }], note);
  await guest.dispose();
  return accept ? transition(ownerApi, placed.id, "accept") : placed;
}

test("waiter order composed offline is not sent until online, then reaches the kitchen once", async ({
  newContext,
  ownerApi,
  demo,
}) => {
  const note = `offline-order-${uniqueSuffix()}`;
  const table = await freshTable(ownerApi, demo.branchId);
  const { context, page } = await newContext("waiter");
  await openOps(page, `/waiter/${demo.branchId}`);
  const dialog = await composeStaffOrder(page, table.name, /Masala Chai/);

  await context.setOffline(true);
  await expect(page.getByText("You're offline.")).toBeVisible();
  await dialog.getByRole("button", { name: /Masala Chai/ }).click();
  await dialog.getByLabel("Instructions").fill(note);
  await dialog.getByRole("button", { name: "Save order — send when online" }).click();

  const drawer = page.getByRole("dialog", { name: table.name });
  await expect(drawer.getByText("Not sent — will send when online")).toBeVisible();
  await expect(drawer.getByText("1× Masala Chai")).toBeVisible();
  await expect(page.getByText(new RegExp(`sent for ${table.name}`))).toHaveCount(0);
  expect(await ordersWithNote(ownerApi, demo.branchId, note)).toHaveLength(0);

  // Every send of this order that leaves the page.
  let sends = 0;
  page.on("request", (req) => {
    if (
      req.method() === "POST" &&
      new URL(req.url()).pathname === `/api/v1/branches/${demo.branchId}/orders` &&
      (req.postData() ?? "").includes(note)
    )
      sends++;
  });

  await context.setOffline(false);
  await expect(drawer.getByText("Not sent — will send when online")).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect
    .poll(async () => (await ordersWithNote(ownerApi, demo.branchId, note)).length)
    .toBe(1);

  const feed = await data<{ active: OrderLike[] }>(
    await ownerApi.get(`/api/v1/branches/${demo.branchId}/kitchen`),
  );
  const tickets = feed.active.filter((o) => o.specialInstructions === note);
  expect(tickets).toHaveLength(1);
  expect(tickets[0]!.status).toBe("ACCEPTED");

  // Further sync triggers (online event, Sync now) never create a second order.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await drawer.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: /^Sync status:/ }).click();
  const sheet = page.getByRole("dialog", { name: "Sync status" });
  const syncNow = sheet.getByRole("button", { name: "Sync now" });
  const forcedProbe = page.waitForResponse((r) => r.url().includes("/api/v1/sync/ping"));
  await syncNow.click();
  await forcedProbe;
  // The forced run is over once the button is usable again.
  await expect(syncNow).toBeEnabled();
  await expect(sheet.getByText("Synced").first()).toBeVisible();
  expect(sends).toBe(1);
  expect(await ordersWithNote(ownerApi, demo.branchId, note)).toHaveLength(1);
});

test("kitchen marks items ready offline; they show waiting, survive a reload, and sync when online", async ({
  newContext,
  ownerApi,
  demo,
}) => {
  const note = `offline-kds-${uniqueSuffix()}`;
  const table = await freshTable(ownerApi, demo.branchId);
  const placed = await acceptedGuestOrder(ownerApi, table, demo.items["Masala Chai"]!.id, note);

  const { context, page } = await newContext("kitchen");
  await openOps(page, `/kitchen/${demo.branchId}`);
  const ticket = page.getByRole("article", { name: `Order ${placed.orderNumber}, ${table.name}` });
  await expect(ticket).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText("You're offline.")).toBeVisible();
  await ticket.getByRole("button", { name: /^1 Masala Chai: pending/ }).click();
  await ticket
    .getByRole("button", { name: /^1 Masala Chai: waiting to sync\. Tap to mark ready/ })
    .click();
  // Both changes are stored on the device (the line shows the queued "ready" step).
  await expect(
    ticket.getByRole("button", {
      name: /^1 Masala Chai: waiting to sync\. Tap to mark preparing$/,
    }),
  ).toBeVisible();

  await expect(ticket.getByText("Waiting to sync").first()).toBeVisible();
  await expect(ticket.getByText("Waiting for pickup")).toHaveCount(0);
  await expect(ticket.getByText("Ready", { exact: true })).toHaveCount(0);
  const [stillQueued] = await ordersWithNote(ownerApi, demo.branchId, note);
  expect(stillQueued!.status).toBe("ACCEPTED");

  // The screen and its queue survive a reload while offline (page from the
  // service worker, data and queue from IndexedDB).
  await page.reload();
  await expect(ticket.getByText("Waiting to sync").first()).toBeVisible();

  await context.setOffline(false);
  await expect
    .poll(
      async () => {
        const [o] = await ordersWithNote(ownerApi, demo.branchId, note);
        return [o!.status, o!.items.map((i) => i.status).join()];
      },
      { timeout: 20_000 },
    )
    .toEqual(["READY", "READY"]);
  await expect(ticket.getByText("Waiting to sync")).toHaveCount(0, { timeout: 20_000 });
  await expect(ticket.getByText("Waiting for pickup")).toBeVisible();
});

test("two kitchen screens converge after one of them syncs offline work", async ({
  newContext,
  ownerApi,
  demo,
}) => {
  const note = `converge-${uniqueSuffix()}`;
  const table = await freshTable(ownerApi, demo.branchId);
  const placed = await acceptedGuestOrder(ownerApi, table, demo.items["Mango Lassi"]!.id, note);
  const name = `Order ${placed.orderNumber}, ${table.name}`;

  const a = await newContext("kitchen");
  const b = await newContext("manager");
  await openOps(a.page, `/kitchen/${demo.branchId}`);
  await openOps(b.page, `/kitchen/${demo.branchId}`);
  await expect(a.page.getByRole("article", { name })).toBeVisible();
  await expect(b.page.getByRole("article", { name })).toBeVisible();

  await a.context.setOffline(true);
  await a.page.getByRole("article", { name }).getByRole("button", { name: "Start" }).click();
  await expect(
    a.page.getByRole("article", { name }).getByText("Waiting to sync").first(),
  ).toBeVisible();
  // The other screen still shows the server's state: nothing started yet.
  await expect(
    b.page.getByRole("article", { name }).getByRole("button", { name: "Start" }),
  ).toBeVisible();

  await a.context.setOffline(false);
  await expect
    .poll(async () => (await ordersWithNote(ownerApi, demo.branchId, note))[0]!.status, {
      timeout: 20_000,
    })
    .toBe("PREPARING");
  await expect(
    b.page.getByRole("article", { name }).getByRole("button", { name: "Start" }),
  ).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(
    a.page.getByRole("article", { name }).getByRole("button", { name: "Start" }),
  ).toHaveCount(0);
});

test("a queued change refused by the server is kept as a conflict, never shown as done", async ({
  newContext,
  ownerApi,
  demo,
}) => {
  const note = `refused-${uniqueSuffix()}`;
  const table = await freshTable(ownerApi, demo.branchId);
  const placed = await acceptedGuestOrder(ownerApi, table, demo.items["Masala Chai"]!.id, note);

  const { context, page } = await newContext("kitchen");
  await openOps(page, `/kitchen/${demo.branchId}`);
  const ticket = page.getByRole("article", { name: `Order ${placed.orderNumber}, ${table.name}` });
  await expect(ticket.getByRole("button", { name: "Start" })).toBeVisible();
  await context.setOffline(true);
  await ticket.getByRole("button", { name: "Start" }).click();
  await expect(ticket.getByText("Waiting to sync").first()).toBeVisible();

  // Meanwhile the manager cancels the order from another device.
  const order = await data<OrderLike>(await ownerApi.get(`/api/v1/orders/${placed.id}`));
  await data(
    await ownerApi.post(`/api/v1/orders/${placed.id}/transition`, {
      data: { action: "cancel", reason: "Guest left", expectedVersion: order.version },
    }),
  );

  await context.setOffline(false);
  await page
    .getByRole("button", { name: /^Sync status: .*need attention/ })
    .click({ timeout: 20_000 });
  const sheet = page.getByRole("dialog", { name: "Sync status" });
  await expect(sheet.getByText("Conflict").first()).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Discard" })).toBeVisible();
  const [after] = await ordersWithNote(ownerApi, demo.branchId, note);
  expect(after!.status).toBe("CANCELLED");

  await sheet.getByRole("button", { name: "Discard" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Discard change" }).click();
  await expect(sheet.getByText("Conflict")).toHaveCount(0);
});

test("a staff order sent after the table got a new session is held and can be retried onto it", async ({
  newContext,
  ownerApi,
  demo,
}) => {
  const note = `session-${uniqueSuffix()}`;
  // A free table: the order is composed expecting no open session.
  const table = await freshTable(ownerApi, demo.branchId);
  const { context, page } = await newContext("waiter");
  await openOps(page, `/waiter/${demo.branchId}`);
  const dialog = await composeStaffOrder(page, table.name, /Fresh Lime Soda/);
  await context.setOffline(true);
  await dialog.getByRole("button", { name: /Fresh Lime Soda/ }).click();
  await dialog.getByLabel("Instructions").fill(note);
  await dialog.getByRole("button", { name: "Save order — send when online" }).click();

  // While the waiter is offline, guests sit down and open a session from the QR code.
  const guestOrder = await acceptedGuestOrder(
    ownerApi,
    table,
    demo.items["Masala Chai"]!.id,
    note,
    false,
  );

  await context.setOffline(false);
  const drawer = page.getByRole("dialog", { name: table.name });
  await expect(drawer.getByText("Not sent — needs attention")).toBeVisible({ timeout: 20_000 });
  await expect(
    drawer.getByText(/The table's session changed since this order was composed/),
  ).toBeVisible();
  // The table drawer is modal; close it to reach the header.
  await drawer.getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: /^Sync status: .*need attention/ }).click();
  const sheet = page.getByRole("dialog", { name: "Sync status" });
  await expect(sheet.getByText("Conflict").first()).toBeVisible();
  // Only the guest's order exists: the held one was not silently added.
  expect((await ordersWithNote(ownerApi, demo.branchId, note)).map((o) => o.id)).toEqual([
    guestOrder.id,
  ]);

  await sheet.getByRole("button", { name: "Retry with latest" }).click();
  await expect
    .poll(async () => (await ordersWithNote(ownerApi, demo.branchId, note)).length)
    .toBe(2);
  const both = await ordersWithNote(ownerApi, demo.branchId, note);
  expect(new Set(both.map((o) => o.sessionId)).size).toBe(1);
});

test("queued order: a lost answer and a server error are retried, and the server keeps one order", async ({
  newContext,
  ownerApi,
  demo,
}) => {
  const note = `retry-${uniqueSuffix()}`;
  const table = await freshTable(ownerApi, demo.branchId);
  const { context, page } = await newContext("waiter");
  await openOps(page, `/waiter/${demo.branchId}`);
  const dialog = await composeStaffOrder(page, table.name, /Mango Lassi/);
  await context.setOffline(true);
  await dialog.getByRole("button", { name: /Mango Lassi/ }).click();
  await dialog.getByLabel("Instructions").fill(note);
  await dialog.getByRole("button", { name: "Save order — send when online" }).click();
  const drawer = page.getByRole("dialog", { name: table.name });
  await expect(drawer.getByText("Not sent — will send when online")).toBeVisible();

  // 1st send: the server creates the order but the answer is lost. 2nd: 503. 3rd: replayed.
  const attempts: string[] = [];
  await page.route(
    (url) => url.pathname === `/api/v1/branches/${demo.branchId}/orders`,
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const body = route.request().postDataJSON() as { specialInstructions?: string } | null;
      if (body?.specialInstructions !== note) return route.fallback();
      attempts.push(route.request().headers()["idempotency-key"] ?? "");
      if (attempts.length === 1) {
        await route.fetch();
        return route.abort("connectionreset");
      }
      if (attempts.length === 2) return route.fulfill({ status: 503, body: "{}" });
      return route.fallback();
    },
  );
  await context.setOffline(false);
  await expect(drawer.getByText("Not sent — will send when online")).toHaveCount(0, {
    timeout: 45_000,
  });
  expect(attempts.length).toBeGreaterThanOrEqual(3);
  expect(new Set(attempts).size, "one idempotency key for every attempt").toBe(1);
  expect(await ordersWithNote(ownerApi, demo.branchId, note)).toHaveLength(1);
});

test("accepting orders and recording payments are disabled offline with the reason", async ({
  newContext,
  ownerApi,
  demo,
}) => {
  const note = `needs-net-${uniqueSuffix()}`;
  const table = await freshTable(ownerApi, demo.branchId);
  const placed = await acceptedGuestOrder(
    ownerApi,
    table,
    demo.items["Masala Chai"]!.id,
    note,
    false,
  );

  const waiter = await newContext("waiter");
  await openOps(waiter.page, `/waiter/${demo.branchId}`);
  const card = waiter.page.locator('[data-slot="card"]').filter({
    has: waiter.page.getByRole("button", { name: `Open order ${placed.orderNumber} details` }),
  });
  const accept = card.getByRole("button", { name: "Accept" });
  await expect(accept).toBeEnabled();
  await waiter.context.setOffline(true);
  await expect(accept).toBeDisabled();
  await expect(card.getByText("Accepting or rejecting orders needs a connection.")).toBeVisible();
  expect((await ordersWithNote(ownerApi, demo.branchId, note))[0]!.status).toBe("PENDING");

  // Serve it and issue the bill online (as the owner), then try to take payment offline.
  const order = await transition(ownerApi, placed.id, "accept", "start", "ready", "serve");
  await issueBill(ownerApi, demo.branchId, order.sessionId);

  const cashier = await newContext("cashier");
  await openOps(cashier.page, `/cashier/${demo.branchId}`);
  await cashier.page.getByRole("button", { name: new RegExp(`^${table.name} · #`) }).click();
  const record = cashier.page
    .getByRole("form", { name: "Record payment" })
    .getByRole("button", { name: /^Record / });
  await expect(record).toBeEnabled();
  await cashier.context.setOffline(true);
  await expect(record).toBeDisabled();
  await expect(cashier.page.getByText(/Recording a payment needs a connection/)).toBeVisible();
});
