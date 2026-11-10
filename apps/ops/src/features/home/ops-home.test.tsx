import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MeResponse } from "@ros/contracts/auth";
import type { BranchContextDto, WorkspaceStructureDto } from "@ros/contracts/structure";
import { ROLE_TEMPLATES } from "@ros/domain/access/permissions";
import { sessionKeys } from "@ros/web-core/features/session/queries";

import { OpsHome } from "./ops-home";

const WS = "11111111-1111-4111-8111-111111111111";
const BR = "22222222-2222-4222-8222-222222222222";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const me = {
  user: { id: "u1", email: "k@example.in", name: "Kiran Kitchen", emailVerified: true },
  activeWorkspaceId: WS,
  workspaces: [{ id: WS, name: "Sharma Foods", roleName: "Member" }],
} as unknown as MeResponse;

const structure = {
  workspaceId: WS,
  workspaceName: "Sharma Foods",
  permissions: ["workspace.view"],
  restaurants: [
    {
      id: "r1",
      name: "Dosa Corner",
      branches: [{ id: BR, name: "Baner", code: "BN", city: "Pune", status: "ACTIVE" }],
    },
  ],
} as unknown as WorkspaceStructureDto;

function renderHome(permissions: readonly string[]) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(sessionKeys.me, me);
  qc.setQueryData(sessionKeys.structure(WS), structure);
  qc.setQueryData(sessionKeys.branchContext(BR), { branchId: BR, permissions } as BranchContextDto);
  return render(
    <QueryClientProvider client={qc}>
      <OpsHome />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const consoles = () =>
  ["Waiter", "Kitchen", "Cashier"].filter((name) => screen.queryByRole("link", { name }));

describe("OpsHome consoles", () => {
  // Each link needs exactly what its page and API need: Waiter orders.view,
  // Kitchen kitchen.view, Cashier bills.view.
  it("shows a kitchen user only the kitchen display", async () => {
    renderHome(ROLE_TEMPLATES.kitchen_staff.permissions);
    expect(await screen.findByRole("link", { name: "Kitchen" })).toHaveAttribute(
      "href",
      `/kitchen/${BR}`,
    );
    expect(consoles()).toEqual(["Kitchen"]);
  });

  it("shows waiters and cashiers the waiter and cashier consoles their role can open", async () => {
    renderHome(ROLE_TEMPLATES.waiter.permissions);
    await screen.findByRole("link", { name: "Waiter" });
    expect(consoles()).toEqual(["Waiter", "Cashier"]);
  });

  it("shows a cashier the waiter console too (orders.view is enough to open it)", async () => {
    renderHome(ROLE_TEMPLATES.cashier.permissions);
    await screen.findByRole("link", { name: "Cashier" });
    expect(consoles()).toEqual(["Waiter", "Cashier"]);
  });

  it("shows a custom runner role (orders.view only) the waiter console", async () => {
    renderHome(["branch.view", "orders.view", "orders.serve"]);
    await screen.findByRole("link", { name: "Waiter" });
    expect(consoles()).toEqual(["Waiter"]);
  });

  it("shows a manager every console", async () => {
    renderHome(ROLE_TEMPLATES.restaurant_manager.permissions);
    await screen.findByRole("link", { name: "Waiter" });
    expect(consoles()).toEqual(["Waiter", "Kitchen", "Cashier"]);
  });

  it("says so when the role has no console at a branch", async () => {
    renderHome(["branch.view"]);
    expect(await screen.findByText("No consoles for your role here")).toBeInTheDocument();
  });

  it("offers a retry instead of 'no consoles' when the branch can't be loaded", async () => {
    // Only the branch context is fetched; the seeded account and structure stay fresh.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    qc.setQueryData(sessionKeys.me, me);
    qc.setQueryData(sessionKeys.structure(WS), structure);
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes(`/branches/${BR}/context`)) {
          if (fail) {
            return new Response(JSON.stringify({ error: { code: "INTERNAL", message: "boom" } }), {
              status: 500,
              headers: { "content-type": "application/json" },
            });
          }
          return new Response(
            JSON.stringify({ data: { branchId: BR, permissions: ["kitchen.view"] } }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response("{}", { status: 404 });
      }),
    );
    render(
      <QueryClientProvider client={qc}>
        <OpsHome />
      </QueryClientProvider>,
    );
    // The context query retries a 5xx twice (about 3 s) before it reports an error.
    const retry = await screen.findByRole("button", { name: "Try again" }, { timeout: 6_000 });
    expect(screen.queryByText("No consoles for your role here")).not.toBeInTheDocument();
    fail = false;
    await userEvent.click(retry);
    expect(await screen.findByRole("link", { name: "Kitchen" })).toBeInTheDocument();
  });
});
