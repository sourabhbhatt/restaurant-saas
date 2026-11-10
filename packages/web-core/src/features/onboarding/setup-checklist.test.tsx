import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BranchMenu } from "@ros/contracts/menu";
import type { OrderDto } from "@ros/contracts/orders";
import type { TableDto } from "@ros/contracts/tables";

import { SetupChecklist } from "./setup-checklist";
import { setupDone } from "./setup-progress";

const WS = "11111111-1111-4111-8111-111111111111";
const BR = "22222222-2222-4222-8222-222222222222";
const T1 = "33333333-3333-4333-8333-333333333333";

const menuWith = (items: number): BranchMenu =>
  ({
    categories: [{ id: "c1", name: "Mains", items: Array.from({ length: items }, () => ({})) }],
  }) as unknown as BranchMenu;

const table = (qr: boolean, isActive = true): TableDto =>
  ({
    id: T1,
    branchId: BR,
    name: "T1",
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

function mockApi(routes: Record<string, unknown>) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url, "http://localhost").pathname;
      const method = init?.method ?? "GET";
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      const data = routes[`${method} ${path}`];
      if (data === undefined) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

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
  return { ...view, settled };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("setupDone", () => {
  it("is driven by the branch's real menu, tables, QR codes and orders", () => {
    expect(setupDone({ menu: menuWith(0), tables: [], orders: [] })).toEqual({
      menu: false,
      tables: false,
      qr: false,
      "test-order": false,
      accept: false,
    });
    expect(
      setupDone({ menu: menuWith(2), tables: [table(true)], orders: [order("PENDING")] }),
    ).toEqual({ menu: true, tables: true, qr: true, "test-order": true, accept: false });
    expect(
      setupDone({ menu: menuWith(1), tables: [table(true)], orders: [order("PREPARING")] }).accept,
    ).toBe(true);
  });

  it("ignores inactive tables and needs a QR code on every active one", () => {
    expect(setupDone({ menu: undefined, tables: [table(false, false)], orders: [] }).tables).toBe(
      false,
    );
    expect(
      setupDone({
        menu: undefined,
        tables: [table(true), { ...table(false), id: "t2" }],
        orders: [],
      }).qr,
    ).toBe(false);
  });
});

describe("SetupChecklist", () => {
  it("points a new owner at the next real step", async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}`]: workspace(),
      [`GET /api/v1/branches/${BR}/menu`]: menuWith(1),
      [`GET /api/v1/branches/${BR}/tables`]: [table(false)],
      [`GET /api/v1/branches/${BR}/orders`]: [],
    });
    renderChecklist();
    const card = await screen.findByRole("heading", { name: "Get ready for your first order" });
    const list = within(card.closest("[data-slot=card]") as HTMLElement).getByRole("list");
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

  it("lets the owner place a test order on a real table's guest page", async () => {
    mockApi({
      [`GET /api/v1/workspaces/${WS}`]: workspace(),
      [`GET /api/v1/branches/${BR}/menu`]: menuWith(3),
      [`GET /api/v1/branches/${BR}/tables`]: [table(true)],
      [`GET /api/v1/branches/${BR}/orders`]: [],
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

  it("disappears once the first order has been accepted", async () => {
    const calls = mockApi({
      [`GET /api/v1/workspaces/${WS}`]: workspace(),
      [`GET /api/v1/branches/${BR}/menu`]: menuWith(3),
      [`GET /api/v1/branches/${BR}/tables`]: [table(true)],
      [`GET /api/v1/branches/${BR}/orders`]: [order("ACCEPTED")],
    });
    const { container, settled } = renderChecklist();
    await waitFor(() =>
      expect(calls.some((c) => c.path === `/api/v1/branches/${BR}/orders`)).toBe(true),
    );
    await settled();
    expect(container).toBeEmptyDOMElement();
  });

  it("stays hidden after it was dismissed and does not load branch data", async () => {
    const calls = mockApi({ [`GET /api/v1/workspaces/${WS}`]: workspace("2026-11-01") });
    const { container, settled } = renderChecklist();
    await settled();
    expect(calls).toHaveLength(1);
    expect(container).toBeEmptyDOMElement();
  });

  it("can be hidden for good", async () => {
    const calls = mockApi({
      [`GET /api/v1/workspaces/${WS}`]: workspace(),
      [`GET /api/v1/branches/${BR}/menu`]: menuWith(0),
      [`GET /api/v1/branches/${BR}/tables`]: [],
      [`GET /api/v1/branches/${BR}/orders`]: [],
      [`PUT /api/v1/workspaces/${WS}/onboarding`]: {},
    });
    renderChecklist();
    await userEvent.click(await screen.findByRole("button", { name: "Hide setup checklist" }));
    await waitFor(() =>
      expect(calls).toContainEqual({
        method: "PUT",
        path: `/api/v1/workspaces/${WS}/onboarding`,
        body: { dismiss: true },
      }),
    );
  });
});
