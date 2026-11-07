import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import { opsURL } from "../../playwright.config";

/**
 * Offline-first staff flows against a production build (service worker on).
 * Needs the demo data from `pnpm db:seed` in the server's database; use a
 * fresh PGLITE_DATA_DIR for the test server, never real data.
 */

const STAFF_PASSWORD = "Demo-Staff-2026";
const OWNER = { email: "owner@demo.local", password: "Demo-Owner-2026" };

test.describe.configure({ mode: "serial" });
// One device profile is enough; the flows share server state, so they run once, in order.
test.skip(({ isMobile }) => isMobile, "runs on desktop-chrome only");

interface Ctx {
  baseURL: string;
  owner: APIRequestContext;
  branchId: string;
  tables: Record<string, string>;
  menuItemId: string;
}

let ctx: Ctx;
const marker = `offline-e2e-${Date.now().toString(36)}`;

async function signIn(api: APIRequestContext, email: string, password: string) {
  const res = await api.post("/api/v1/auth/signin", { data: { email, password } });
  expect(res.status(), await res.text()).toBe(200);
}

async function data<T>(res: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<T> {
  expect(res.ok(), `${res.url()} → ${res.status()} ${await res.text()}`).toBeTruthy();
  return ((await res.json()) as { data: T }).data;
}

/** A browser context on the ops app signed in as `email` (cookies come from the API sign-in). */
async function staffPage(
  browser: Browser,
  email: string,
  path: string,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ baseURL: opsURL });
  await signIn(context.request, email, STAFF_PASSWORD);
  const page = await context.newPage();
  await page.goto(path);
  // Static chunks must be cached before the network goes away.
  await page.evaluate(() => navigator.serviceWorker.ready);
  return { context, page };
}

interface OrderLike {
  id: string;
  orderNumber: number;
  status: string;
  version: number;
  sessionId: string;
  specialInstructions: string | null;
  items: { status: string; itemName: string }[];
}

async function ordersWithMarker(): Promise<OrderLike[]> {
  const list = await data<OrderLike[]>(
    await ctx.owner.get(`/api/v1/branches/${ctx.branchId}/orders`, { params: { limit: 200 } }),
  );
  return list.filter((o) => o.specialInstructions === marker);
}

test.beforeAll(async ({ baseURL }) => {
  const base = baseURL!;
  const owner = await playwrightRequest.newContext({
    baseURL: base,
    // route() requires a same-origin Origin header on cookie-authenticated mutations.
    extraHTTPHeaders: { origin: new URL(base).origin },
  });
  await signIn(owner, OWNER.email, OWNER.password);
  const me = await data<{ activeWorkspaceId: string }>(await owner.get("/api/v1/auth/me"));
  const structure = await data<{ restaurants: { branches: { id: string; name: string }[] }[] }>(
    await owner.get(`/api/v1/workspaces/${me.activeWorkspaceId}/structure`),
  );
  const branch = structure.restaurants
    .flatMap((r) => r.branches)
    .find((b) => b.name === "Indiranagar");
  expect(branch, "seeded Indiranagar branch").toBeDefined();
  const branchId = branch!.id;
  const tables = await data<{ id: string; name: string }[]>(
    await owner.get(`/api/v1/branches/${branchId}/tables`),
  );
  const menu = await data<{ categories: { items: { id: string; name: string }[] }[] }>(
    await owner.get(`/api/v1/branches/${branchId}/menu`),
  );
  const chai = menu.categories.flatMap((c) => c.items).find((i) => i.name === "Masala Chai");
  ctx = {
    baseURL: base,
    owner,
    branchId,
    tables: Object.fromEntries(tables.map((t) => [t.name, t.id])),
    menuItemId: chai!.id,
  };
});

test.afterAll(async () => {
  await ctx?.owner.dispose();
});

test("waiter order composed offline is not sent until online, then reaches the kitchen once", async ({
  browser,
}) => {
  const { context, page } = await staffPage(
    browser,
    "waiter@demo.local",
    `/waiter/${ctx.branchId}`,
  );
  await page.getByRole("tab", { name: "Tables" }).click();
  await page.getByRole("button", { name: /^T5:/ }).click();
  await page.getByRole("button", { name: "Add items" }).click();
  const dialog = page.getByRole("dialog", { name: /Add items · T5/ });
  // Menu loaded while online; it is kept for offline use.
  await expect(dialog.getByRole("button", { name: /Masala Chai/ })).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText("You're offline.")).toBeVisible();
  await dialog.getByRole("button", { name: /Masala Chai/ }).click();
  await dialog.getByLabel("Instructions").fill(marker);
  await dialog.getByRole("button", { name: "Save order — send when online" }).click();

  const drawer = page.getByRole("dialog", { name: "T5" });
  await expect(drawer.getByText("Not sent — will send when online")).toBeVisible();
  await expect(drawer.getByText("1× Masala Chai")).toBeVisible();
  await expect(page.getByText(/sent for T5/)).toHaveCount(0);
  expect(await ordersWithMarker()).toHaveLength(0);

  await context.setOffline(false);
  await expect(drawer.getByText("Not sent — will send when online")).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect.poll(async () => (await ordersWithMarker()).length).toBe(1);

  const feed = await data<{ active: OrderLike[] }>(
    await ctx.owner.get(`/api/v1/branches/${ctx.branchId}/kitchen`),
  );
  const tickets = feed.active.filter((o) => o.specialInstructions === marker);
  expect(tickets).toHaveLength(1);
  expect(tickets[0]!.status).toBe("ACCEPTED");

  // Further syncs (interval, visibility) never create a second order.
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForTimeout(1_500);
  expect(await ordersWithMarker()).toHaveLength(1);
  await context.close();
});

test("kitchen marks an item ready offline; it shows waiting and syncs when online", async ({
  browser,
}) => {
  const [order] = await ordersWithMarker();
  expect(order, "order from the previous test").toBeDefined();
  const { context, page } = await staffPage(
    browser,
    "kitchen@demo.local",
    `/kitchen/${ctx.branchId}`,
  );
  const ticket = page.getByRole("article", { name: `Order ${order!.orderNumber}, T5` });
  await expect(ticket).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText("You're offline.")).toBeVisible();
  await ticket.getByRole("button", { name: /^1 Masala Chai: pending/ }).click();
  await ticket
    .getByRole("button", { name: /^1 Masala Chai: waiting to sync\. Tap to mark ready/ })
    .click();

  await expect(ticket.getByText("Waiting to sync").first()).toBeVisible();
  await expect(ticket.getByText("Waiting for pickup")).toHaveCount(0);
  await expect(ticket.getByText("Ready", { exact: true })).toHaveCount(0);
  const [stillQueued] = await ordersWithMarker();
  expect(stillQueued!.status).toBe("ACCEPTED");

  await context.setOffline(false);
  await expect
    .poll(async () => {
      const [o] = await ordersWithMarker();
      return [o!.status, o!.items.map((i) => i.status).join()];
    })
    .toEqual(["READY", "READY"]);
  await expect(ticket.getByText("Waiting to sync")).toHaveCount(0, { timeout: 30_000 });
  await expect(ticket.getByText("Waiting for pickup")).toBeVisible();
  await context.close();
});

test("accepting orders and recording payments are disabled offline with the reason", async ({
  browser,
}) => {
  // A guest order (PENDING) on T7.
  const qr = await data<{ tables: { url: string }[] }>(
    await ctx.owner.get(`/api/v1/branches/${ctx.branchId}/tables/qr-sheet`, {
      params: { tableIds: ctx.tables.T7! },
    }),
  );
  const token = new URL(qr.tables[0]!.url).pathname.split("/").pop()!;
  const guest = await playwrightRequest.newContext({
    baseURL: ctx.baseURL,
    extraHTTPHeaders: { origin: new URL(ctx.baseURL).origin },
  });
  expect((await guest.post(`/api/v1/public/qr/${token}/session`)).ok()).toBeTruthy();
  await data(
    await guest.post("/api/v1/public/session/orders", {
      data: {
        idempotencyKey: `guest_${Date.now()}`,
        lines: [{ menuItemId: ctx.menuItemId, quantity: 1, addonIds: [] }],
      },
    }),
  );
  await guest.dispose();

  const waiter = await staffPage(browser, "waiter@demo.local", `/waiter/${ctx.branchId}`);
  const accept = waiter.page.getByRole("button", { name: "Accept" }).first();
  await expect(accept).toBeEnabled();
  await waiter.context.setOffline(true);
  await expect(accept).toBeDisabled();
  await expect(
    waiter.page.getByText("Accepting or rejecting orders needs a connection.").first(),
  ).toBeVisible();
  await waiter.context.close();

  // Serve the T5 order and issue its bill (online, as the owner).
  const [order] = await ordersWithMarker();
  await data(
    await ctx.owner.post(`/api/v1/orders/${order!.id}/transition`, {
      data: { action: "serve", expectedVersion: order!.version },
    }),
  );
  await data(
    await ctx.owner.post(`/api/v1/branches/${ctx.branchId}/bills`, {
      data: { sessionId: order!.sessionId, discount: null, idempotencyKey: `bill_${marker}` },
      headers: { "idempotency-key": `bill_${marker}` },
    }),
  );

  const cashier = await staffPage(browser, "cashier@demo.local", `/cashier/${ctx.branchId}`);
  await cashier.page.getByRole("button", { name: /^T5 · #/ }).click();
  const record = cashier.page
    .getByRole("form", { name: "Record payment" })
    .getByRole("button", { name: /^Record / });
  await expect(record).toBeEnabled();
  await cashier.context.setOffline(true);
  await expect(record).toBeDisabled();
  await expect(cashier.page.getByText(/Recording a payment needs a connection/)).toBeVisible();
  await cashier.context.close();
});
