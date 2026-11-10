import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BranchMenu } from "@ros/contracts/menu";
import type { OrderDto } from "@ros/contracts/orders";
import type { TableDto } from "@ros/contracts/tables";

import { toast } from "sonner";

import { SetupChecklist } from "./setup-checklist";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { SETUP_POLL_MS, setupDone, setupGoalReached } from "./setup-progress";

const WS = "11111111-1111-4111-8111-111111111111";
const BR = "22222222-2222-4222-8222-222222222222";
const T1 = "33333333-3333-4333-8333-333333333333";
const T2 = "44444444-4444-4444-8444-444444444444";
const ORDERS = `/api/v1/branches/${BR}/orders`;

const menuWith = (items: number): BranchMenu =>
  ({
    categories: [{ id: "c1", name: "Mains", items: Array.from({ length: items }, () => ({})) }],
  }) as unknown as BranchMenu;

const table = (qr: boolean, isActive = true, id = T1): TableDto =>
  ({
    id,
    branchId: BR,
    name: id === T1 ? "T1" : "Counter",
    isActive,
    qr: { active: qr, createdAt: qr ? new Date().toISOString() : null },
  }) as unknown as TableDto;

const order = (status: string) => ({ id: "o1", status }) as unknown as OrderDto;

function workspace(dismissedAt: string | null = null) {
  return {
    workspace: {
      id: WS,
      onboarding: { completedSteps: [], currentStep: null, dismissedAt, branchId: BR },
    },
    membership: { roleKey: "workspace_owner", permissions: [] },
  };
}

type Route = unknown | ((url: URL) => unknown);

/** Answers `METHOD /path` routes; a function route sees the full URL (query string). */
function mockApi(routes: Record<string, Route>) {
  const calls: { method: string; path: string; search: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = new URL(url, "http://localhost");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path: u.pathname, search: u.search, body });
      const route = routes[`${method} ${u.pathname}`];
      const data = typeof route === "function" ? (route as (url: URL) => unknown)(u) : route;
      if (data instanceof Response) return data;
      if (data === undefined) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

/** Orders route: filters by `status=` (comma list) and `limit`, like the API. */
const ordersRoute =
  (state: { orders: OrderDto[] }) =>
  (u: URL): OrderDto[] => {
    const wanted = u.searchParams.get("status")?.split(",");
    const limit = Number(u.searchParams.get("limit") ?? 100);
    return state.orders.filter((o) => !wanted || wanted.includes(o.status)).slice(0, limit);
  };

const restricted = () =>
  new Response(
    JSON.stringify({
      error: { code: "WORKSPACE_RESTRICTED", message: "This workspace is read-only." },
    }),
    { status: 403, headers: { "content-type": "application/json" } },
  );

function renderChecklist() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <SetupChecklist workspaceId={WS} branchId={BR} />
    </QueryClientProvider>,
  );
  /** Resolves once every query the checklist started has answered. */
  const settled = () =>
    waitFor(() => {
      expect(qc.isFetching()).toBe(0);
      expect(qc.getQueryCache().findAll().length).toBeGreaterThan(0);
    });
  return { ...view, qc, settled };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("setupDone", () => {
  it("is driven by the branch's real menu, tables, QR codes and orders", () => {
    const none = { anyOrder: [], acceptedOrder: [] };
    expect(setupDone({ menu: menuWith(0), tables: [], ...none })).toEqual({
      menu: false,
      tables: false,
      qr: false,
      "test-order": false,
      accept: false,
    });
    expect(
      setupDone({
        menu: menuWith(2),
        tables: [table(true)],
        anyOrder: [order("PENDING")],
        acceptedOrder: [],
      }),
    ).toEqual({ menu: true, tables: true, qr: true, "test-order": true, accept: false });
    expect(
      setupDone({
        menu: menuWith(1),
        tables: [table(true)],
        anyOrder: [order("PREPARING")],
        acceptedOrder: [order("PREPARING")],
      }).accept,
    ).toBe(true);
  });

  it("needs one active table with a QR code, not every table", () => {
    const none = { menu: undefined, anyOrder: [], acceptedOrder: [] };
    expect(setupDone({ ...none, tables: [table(false, false)] }).tables).toBe(false);
    // A counter or parcel table without a printed code does not hold the checklist open.
    expect(setupDone({ ...none, tables: [table(true), table(false, true, T2)] }).qr).toBe(true);
    expect(setupDone({ ...none, tables: [table(true, false)] }).qr).toBe(false);
  });

  it("counts a cancelled order as accepted (cancel is only possible after accepting)", () => {
    expect(
      setupDone({
        menu: undefined,
        tables: [table(true)],
        anyOrder: [order("CANCELLED")],
        acceptedOrder: [order("CANCELLED")],
      }).accept,
    ).toBe(true);
    expect(
      setupDone({
        menu: undefined,
        tables: [table(true)],
        anyOrder: [order("REJECTED")],
        acceptedOrder: [order("REJECTED")],
      }).accept,
    ).toBe(false);
  });

  it("is reached once a QR code is live and an order has been accepted", () => {
    const done = setupDone({
      menu: menuWith(0),
      tables: [table(true)],
      anyOrder: [order("SERVED")],
      acceptedOrder: [order("SERVED")],
    });
    expect(setupGoalReached(done)).toBe(true);
    expect(setupGoalReached({ ...done, accept: false })).toBe(false);
    expect(setupGoalReached({ ...done, qr: false })).toBe(false);
  });
});

describe("SetupChecklist", () => {
  it("points a new owner at the next real step, in a labelled region", async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}`]: workspace(),
      [`GET /api/v1/branches/${BR}/menu`]: menuWith(1),
      [`GET /api/v1/branches/${BR}/tables`]: [table(false)],
      [`GET ${ORDERS}`]: [],
    });
    renderChecklist();
    const region = await screen.findByRole("region", { name: "Get ready for your first order" });
    const list = within(region).getByRole("list");
    expect(screen.getByText(/2 of 5 done/)).toBeInTheDocument();

    const next = within(list)
      .getAllByRole("listitem")
      .find((li) => li.getAttribute("aria-current") === "step")!;
    expect(next).toHaveTextContent("Print table QR codes");
    expect(within(next).getByRole("link", { name: /Print QR codes/ })).toHaveAttribute(
      "href",
      `/print/tables?branchId=${BR}`,
    );
    // No QR code yet, so there is no guest page to open.
    expect(screen.getByText("Available once a table has a QR code.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Open guest menu/ })).not.toBeInTheDocument();
  });

  it("keeps the print link once codes exist and says how many tables have one", async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}`]: workspace(),
      [`GET /api/v1/branches/${BR}/menu`]: menuWith(1),
      [`GET /api/v1/branches/${BR}/tables`]: [table(true), table(false, true, T2)],
      [`GET ${ORDERS}`]: [],
      [`GET /api/v1/tables/${T1}/qr`]: { tableId: T1, url: "http://localhost:3000/t/abc" },
    });
    renderChecklist();
    const step = (await screen.findByText(/1 of 2 tables have a QR code/)).closest("li")!;
    expect(step).toHaveTextContent("Print table QR codes (done)");
    expect(within(step).getByRole("link", { name: /Print QR codes/ })).toBeInTheDocument();
  });

  it("lets the owner place a test order on a real table's guest page", async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}`]: workspace(),
      [`GET /api/v1/branches/${BR}/menu`]: menuWith(3),
      [`GET /api/v1/branches/${BR}/tables`]: [table(true)],
      [`GET ${ORDERS}`]: [],
      [`GET /api/v1/tables/${T1}/qr`]: {
        tableId: T1,
        tableName: "T1",
        url: "http://localhost:3000/t/abc",
        svg: "<svg/>",
        createdAt: new Date().toISOString(),
      },
    });
    renderChecklist();
    const link = await screen.findByRole("link", { name: /Open guest menu/ });
    expect(link).toHaveAttribute("href", "http://localhost:3000/t/abc");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("explains the separate staff sign-in and how to clear the test order", async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}`]: workspace(),
      [`GET /api/v1/branches/${BR}/menu`]: menuWith(3),
      [`GET /api/v1/branches/${BR}/tables`]: [table(true)],
      [`GET ${ORDERS}`]: ordersRoute({ orders: [order("PENDING")] }),
    });
    renderChecklist();
    const link = await screen.findByRole("link", { name: /Open waiter console/ });
    const step = link.closest("li")!;
    expect(step).toHaveTextContent(/sign in once with the same account/i);
    expect(step).toHaveTextContent(/cancel the test order and close the table/i);
  });

  it("finishes for good once an order is accepted, even with a table that has no code", async () => {
    const state = { dismissedAt: null as string | null };
    const calls = mockApi({
      [`GET /api/v1/workspaces/${WS}`]: () => workspace(state.dismissedAt),
      [`PUT /api/v1/workspaces/${WS}/onboarding`]: () => {
        state.dismissedAt = "2026-11-10T09:00:00.000Z";
        return {};
      },
      [`GET /api/v1/branches/${BR}/menu`]: menuWith(3),
      [`GET /api/v1/branches/${BR}/tables`]: [table(true), table(false, true, T2)],
      [`GET ${ORDERS}`]: ordersRoute({ orders: [order("ACCEPTED")] }),
    });
    const { container, qc, settled } = renderChecklist();
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "PUT")).toEqual([
        {
          method: "PUT",
          path: `/api/v1/workspaces/${WS}/onboarding`,
          search: "",
          body: { completedStep: "done", dismiss: true },
        },
      ]),
    );
    await settled();
    expect(container).toBeEmptyDOMElement();

    // Every checklist query is switched off, so revisits and refetches send nothing more.
    const before = calls.length;
    await qc.refetchQueries({ type: "active" });
    await settled();
    // Workspace-level queries (detail, entitlements) are shared with the page; no branch data.
    expect(
      calls.slice(before).filter((c) => !c.path.startsWith(`/api/v1/workspaces/${WS}`)),
    ).toEqual([]);
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1);
  });

  it("checks for the test order only while waiting for it, then stops", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const orders = { orders: [] as OrderDto[] };
    const calls = mockApi({
      [`GET /api/v1/workspaces/${WS}`]: workspace(),
      [`PUT /api/v1/workspaces/${WS}/onboarding`]: {},
      [`GET /api/v1/branches/${BR}/menu`]: menuWith(3),
      [`GET /api/v1/branches/${BR}/tables`]: [table(true)],
      [`GET /api/v1/tables/${T1}/qr`]: { tableId: T1, url: "http://localhost:3000/t/abc" },
      [`GET ${ORDERS}`]: ordersRoute(orders),
    });
    const { container, settled } = renderChecklist();
    await screen.findByRole("link", { name: /Open guest menu/ });
    const orderCalls = () => calls.filter((c) => c.path === ORDERS).length;

    // Waiting for the guest's order: polled.
    const waiting = orderCalls();
    await vi.advanceTimersByTimeAsync(SETUP_POLL_MS + 1_000);
    await settled();
    expect(orderCalls()).toBeGreaterThan(waiting);

    // The order arrives and is accepted: one poll sees the order, the next sees it
    // accepted (only one lookup polls at a time); the checklist finishes and polling stops.
    orders.orders = [order("ACCEPTED")];
    await vi.advanceTimersByTimeAsync(SETUP_POLL_MS + 1_000);
    await settled();
    await vi.advanceTimersByTimeAsync(SETUP_POLL_MS + 1_000);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    await settled();
    const after = orderCalls();
    await vi.advanceTimersByTimeAsync(3 * SETUP_POLL_MS);
    expect(orderCalls()).toBe(after);
  });

  it("finishes when the owner accepted the test order and then cancelled it", async () => {
    // The checklist tells owners to cancel the test order afterwards; coming back to the
    // dashboard must not leave "Accept it as a waiter" undone.
    const calls = mockApi({
      [`GET /api/v1/workspaces/${WS}`]: workspace(),
      [`PUT /api/v1/workspaces/${WS}/onboarding`]: {},
      [`GET /api/v1/branches/${BR}/menu`]: menuWith(1),
      [`GET /api/v1/branches/${BR}/tables`]: [table(true)],
      [`GET ${ORDERS}`]: ordersRoute({ orders: [order("CANCELLED")] }),
    });
    const { container } = renderChecklist();
    await waitFor(() =>
      expect(calls.filter((c) => c.method === "PUT").map((c) => c.body)).toEqual([
        { completedStep: "done", dismiss: true },
      ]),
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows and fetches nothing in a read-only or suspended workspace", async () => {
    const calls = mockApi({
      [`GET /api/v1/workspaces/${WS}`]: workspace(),
      [`GET /api/v1/workspaces/${WS}/entitlements`]: {
        entitlements: { accessLevel: "READ_ONLY" },
      },
      [`GET /api/v1/branches/${BR}/menu`]: menuWith(1),
      [`GET /api/v1/branches/${BR}/tables`]: [table(true)],
      [`GET ${ORDERS}`]: ordersRoute({ orders: [order("ACCEPTED")] }),
    });
    const { container, settled } = renderChecklist();
    await settled();
    expect(container).toBeEmptyDOMElement();
    expect(calls.map((c) => `${c.method} ${c.path}`).sort()).toEqual([
      `GET /api/v1/workspaces/${WS}`,
      `GET /api/v1/workspaces/${WS}/entitlements`,
    ]);
  });

  it("treats a refused completion as final on this device, quietly", async () => {
    const routes = {
      [`GET /api/v1/workspaces/${WS}`]: workspace(),
      [`PUT /api/v1/workspaces/${WS}/onboarding`]: restricted,
      [`GET /api/v1/branches/${BR}/menu`]: menuWith(1),
      [`GET /api/v1/branches/${BR}/tables`]: [table(true)],
      [`GET ${ORDERS}`]: ordersRoute({ orders: [order("ACCEPTED")] }),
    };
    const calls = mockApi(routes);
    const first = renderChecklist();
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT")).toHaveLength(1));
    await first.settled();
    expect(first.container).toBeEmptyDOMElement();
    expect(toast.error).not.toHaveBeenCalled();
    first.unmount();

    // Next visit: no second save attempt and no branch data.
    const again = mockApi(routes);
    const second = renderChecklist();
    await second.settled();
    expect(second.container).toBeEmptyDOMElement();
    expect(again.filter((c) => c.method === "PUT")).toHaveLength(0);
    expect(again.some((c) => c.path.startsWith(`/api/v1/branches/`))).toBe(false);
  });

  it("hides on × without an error toast when the workspace can't save it", async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}`]: workspace(),
      [`PUT /api/v1/workspaces/${WS}/onboarding`]: restricted,
      [`GET /api/v1/branches/${BR}/menu`]: menuWith(0),
      [`GET /api/v1/branches/${BR}/tables`]: [],
      [`GET ${ORDERS}`]: [],
    });
    const { container } = renderChecklist();
    await userEvent.click(await screen.findByRole("button", { name: "Hide setup checklist" }));
    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("stays hidden after it was dismissed and does not load branch data", async () => {
    const calls = mockApi({ [`GET /api/v1/workspaces/${WS}`]: workspace("2026-11-01") });
    const { container, settled } = renderChecklist();
    await settled();
    expect(calls.some((c) => c.path.startsWith(`/api/v1/branches/`))).toBe(false);
    expect(container).toBeEmptyDOMElement();
  });

  it("can be hidden for good", async () => {
    const calls = mockApi({
      [`GET /api/v1/workspaces/${WS}`]: workspace(),
      [`GET /api/v1/branches/${BR}/menu`]: menuWith(0),
      [`GET /api/v1/branches/${BR}/tables`]: [],
      [`GET ${ORDERS}`]: [],
      [`PUT /api/v1/workspaces/${WS}/onboarding`]: {},
    });
    renderChecklist();
    await userEvent.click(await screen.findByRole("button", { name: "Hide setup checklist" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "PUT",
        path: `/api/v1/workspaces/${WS}/onboarding`,
        search: "",
        body: { dismiss: true },
      }),
    );
  });
});
