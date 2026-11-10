import {
  test as base,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";

import { DEMO, authFile, type DemoRole } from "./accounts";
import { uniqueIp } from "./ip";
import { E2E_URLS } from "./urls";

export { expect };
export { DEMO, E2E_URLS };

/** Unwraps the API envelope `{ data }`, failing with the server's message otherwise. */
export async function data<T>(res: APIResponse): Promise<T> {
  const body = await res.text();
  expect(res.ok(), `${res.url()} → ${res.status()} ${body}`).toBeTruthy();
  return (JSON.parse(body) as { data: T }).data;
}

/** An API client (through the console's /api/v1 proxy) with its own client IP. */
export async function apiClient(
  storageState?: string | BrowserContextOptions["storageState"],
): Promise<APIRequestContext> {
  const origin = E2E_URLS.console;
  return playwrightRequest.newContext({
    baseURL: origin,
    storageState,
    // route() requires a listed Origin on cookie-authenticated mutations.
    extraHTTPHeaders: { origin, "x-forwarded-for": uniqueIp() },
  });
}

export const uniqueSuffix = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const NEW_ACCOUNT_PASSWORD = "E2e-Account-Pass-2026";

export interface NewOwner {
  /** Signed in as the owner (console proxy). */
  api: APIRequestContext;
  email: string;
  workspaceId: string;
  workspaceName: string;
}

/**
 * A brand-new owner with an empty workspace (new workspaces start on the Pro
 * trial), created over the API. Specs that change subscription or workspace
 * status use one, so the shared demo workspace is never affected.
 */
export async function newOwner(label = "E2E Group"): Promise<NewOwner> {
  const suffix = uniqueSuffix();
  const api = await apiClient();
  const email = `owner-${suffix}@e2e.test`;
  await data(
    await api.post("/api/v1/auth/signup", {
      data: {
        name: `E2E Owner ${suffix}`,
        email,
        password: NEW_ACCOUNT_PASSWORD,
        acceptTerms: true,
      },
    }),
  );
  const workspaceName = `${label} ${suffix}`;
  const ws = await data<{ id: string }>(
    await api.post("/api/v1/workspaces", { data: { name: workspaceName } }),
  );
  return { api, email, workspaceId: ws.id, workspaceName };
}

/**
 * The newest email to `to` in the API's outbox, read through the dev mailbox
 * (test hooks, Super Admin only). Read on the API itself: the frontends'
 * proxies hide /api/v1/dev unless they run with ENABLE_TEST_HOOKS too.
 */
export async function latestEmailTo(to: string): Promise<{ subject: string; text: string }> {
  const admin = await playwrightRequest.newContext({
    baseURL: E2E_URLS.api,
    storageState: authFile("admin"),
    extraHTTPHeaders: { "x-forwarded-for": uniqueIp() },
  });
  try {
    let found: { to: string; subject: string; text: string } | undefined;
    await expect
      .poll(async () => {
        const mails = await data<{ to: string; subject: string; text: string }[]>(
          await admin.get("/api/v1/dev/mailbox"),
        );
        found = mails.find((m) => m.to.toLowerCase() === to.toLowerCase());
        return Boolean(found);
      })
      .toBe(true);
    return found!;
  } finally {
    await admin.dispose();
  }
}

export interface MenuItemLite {
  id: string;
  name: string;
  price: number;
}

export interface DemoData {
  workspaceId: string;
  restaurantId: string;
  branchId: string;
  otherBranchId: string;
  tables: Record<string, string>;
  otherTables: Record<string, string>;
  items: Record<string, MenuItemLite>;
}

type Structure = {
  restaurants: { id: string; name: string; branches: { id: string; name: string }[] }[];
};

async function loadDemo(owner: APIRequestContext): Promise<DemoData> {
  const me = await data<{ activeWorkspaceId: string }>(await owner.get("/api/v1/auth/me"));
  const structure = await data<Structure>(
    await owner.get(`/api/v1/workspaces/${me.activeWorkspaceId}/structure`),
  );
  const restaurant = structure.restaurants.find((r) => r.name === DEMO.restaurantName)!;
  const branch = restaurant.branches.find((b) => b.name === DEMO.branchName)!;
  const other = restaurant.branches.find((b) => b.name === DEMO.otherBranchName)!;
  const tablesOf = async (branchId: string) =>
    Object.fromEntries(
      (
        await data<{ id: string; name: string }[]>(
          await owner.get(`/api/v1/branches/${branchId}/tables`),
        )
      ).map((t) => [t.name, t.id]),
    );
  const menu = await data<{ categories: { items: MenuItemLite[] }[] }>(
    await owner.get(`/api/v1/branches/${branch.id}/menu`),
  );
  return {
    workspaceId: me.activeWorkspaceId,
    restaurantId: restaurant.id,
    branchId: branch.id,
    otherBranchId: other.id,
    tables: await tablesOf(branch.id),
    otherTables: await tablesOf(other.id),
    items: Object.fromEntries(menu.categories.flatMap((c) => c.items).map((i) => [i.name, i])),
  };
}

/** The guest QR token of a table (as printed on its QR code). */
export async function qrToken(
  owner: APIRequestContext,
  branchId: string,
  tableId: string,
): Promise<string> {
  const sheet = await data<{ tables: { url: string }[] }>(
    await owner.get(`/api/v1/branches/${branchId}/tables/qr-sheet`, {
      params: { tableIds: tableId },
    }),
  );
  return new URL(sheet.tables[0]!.url).pathname.split("/").pop()!;
}

export interface FreshTable {
  id: string;
  name: string;
  branchId: string;
}

/**
 * A new table, unique to the calling test, in a seeded branch. Tests never
 * share a table, so a repeat or a CI retry never finds a session, an issued
 * bill or orders left by an earlier attempt. (The demo plan allows 200 tables
 * and every full run starts from a freshly seeded database.)
 */
export async function freshTable(owner: APIRequestContext, branchId: string): Promise<FreshTable> {
  const name = `X${uniqueSuffix()}`;
  const table = await data<{ id: string; name: string }>(
    await owner.post(`/api/v1/branches/${branchId}/tables`, { data: { name, capacity: 4 } }),
  );
  // Its QR code, as the owner would print it before guests can scan.
  await data(await owner.post(`/api/v1/tables/${table.id}/qr`));
  return { id: table.id, name: table.name, branchId };
}

/** A guest API session joined to the table behind `token`. */
export async function guestApi(token: string): Promise<APIRequestContext> {
  const guest = await apiClient();
  await data(await guest.post(`/api/v1/public/qr/${token}/session`));
  return guest;
}

export interface OrderLike {
  id: string;
  orderNumber: number;
  status: string;
  version: number;
  sessionId: string;
  tableName: string;
  specialInstructions: string | null;
  items: { id: string; status: string; itemName: string; quantity: number }[];
}

export async function placeGuestOrder(
  guest: APIRequestContext,
  lines: { menuItemId: string; quantity: number }[],
  specialInstructions?: string,
): Promise<OrderLike> {
  return data<OrderLike>(
    await guest.post("/api/v1/public/session/orders", {
      data: {
        idempotencyKey: `guest_${uniqueSuffix()}`,
        specialInstructions,
        lines: lines.map((l) => ({ ...l, addonIds: [] })),
      },
    }),
  );
}

export async function ordersWithNote(
  api: APIRequestContext,
  branchId: string,
  note: string,
): Promise<OrderLike[]> {
  const list = await data<OrderLike[]>(
    await api.get(`/api/v1/branches/${branchId}/orders`, { params: { limit: 200 } }),
  );
  return list.filter((o) => o.specialInstructions === note);
}

/** Moves an order through the given transitions as `api` (uses the latest version each time). */
export async function transition(
  api: APIRequestContext,
  orderId: string,
  ...actions: ("accept" | "start" | "ready" | "serve")[]
): Promise<OrderLike> {
  let order = await data<OrderLike>(await api.get(`/api/v1/orders/${orderId}`));
  for (const action of actions) {
    order = await data<OrderLike>(
      await api.post(`/api/v1/orders/${orderId}/transition`, {
        data: { action, expectedVersion: order.version },
      }),
    );
  }
  return order;
}

export interface BillLike {
  id: string;
  billNumber: number;
  sessionId: string;
  status: string;
  paymentStatus: string;
  balanceDue: number;
  amountPaid: number;
}

export async function issueBill(
  api: APIRequestContext,
  branchId: string,
  sessionId: string,
): Promise<BillLike> {
  const key = `bill_${uniqueSuffix()}`;
  return data<BillLike>(
    await api.post(`/api/v1/branches/${branchId}/bills`, {
      data: { sessionId, idempotencyKey: key },
      headers: { "idempotency-key": key },
    }),
  );
}

/** Pays the balance in cash and closes the session, so the table is free again. */
export async function settleAndClose(api: APIRequestContext, branchId: string, billId: string) {
  const bill = await data<BillLike>(await api.get(`/api/v1/bills/${billId}`));
  if (bill.balanceDue > 0) {
    const key = `pay_${uniqueSuffix()}`;
    await data(
      await api.post(`/api/v1/bills/${billId}/payments`, {
        data: { method: "CASH", amount: bill.balanceDue, idempotencyKey: key },
        headers: { "idempotency-key": key },
      }),
    );
  }
  await data(await api.post(`/api/v1/branches/${branchId}/sessions/${bill.sessionId}/close`));
}

/** Waits until the service worker controls the page and the app shell is cached. */
export async function serviceWorkerReady(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
}

type Fixtures = {
  /** Opens another browser context (same device profile as the project) signed in as `role`. */
  newContext: (
    role: DemoRole | null,
    options?: BrowserContextOptions,
  ) => Promise<{ context: BrowserContext; page: Page }>;
};

type WorkerFixtures = {
  /** Owner API client (signed in) and ids of the seeded demo workspace. */
  ownerApi: APIRequestContext;
  demo: DemoData;
};

const CONTEXT_KEYS = [
  "viewport",
  "userAgent",
  "deviceScaleFactor",
  "isMobile",
  "hasTouch",
  "locale",
  "timezoneId",
  "reducedMotion",
] as const;

export const test = base.extend<Fixtures, WorkerFixtures>({
  ownerApi: [
    async ({}, provide) => {
      const api = await apiClient(authFile("owner"));
      await provide(api);
      await api.dispose();
    },
    { scope: "worker" },
  ],
  demo: [
    async ({ ownerApi }, provide) => {
      await provide(await loadDemo(ownerApi));
    },
    { scope: "worker" },
  ],
  context: async ({ context }, provide) => {
    await context.setExtraHTTPHeaders({ "x-forwarded-for": uniqueIp() });
    await provide(context);
  },
  newContext: async ({ browser }, provide, testInfo) => {
    const opened: BrowserContext[] = [];
    const device = Object.fromEntries(
      CONTEXT_KEYS.filter((k) => testInfo.project.use[k] !== undefined).map((k) => [
        k,
        testInfo.project.use[k],
      ]),
    ) as BrowserContextOptions;
    await provide(async (role, options = {}) => {
      const context = await browser.newContext({
        ...device,
        baseURL: E2E_URLS.console,
        storageState: role ? authFile(role) : undefined,
        extraHTTPHeaders: { "x-forwarded-for": uniqueIp() },
        ...options,
      });
      opened.push(context);
      return { context, page: await context.newPage() };
    });
    await Promise.all(opened.map((c) => c.close()));
  },
});
