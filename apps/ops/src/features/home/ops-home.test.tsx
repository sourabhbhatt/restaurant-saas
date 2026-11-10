import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MeResponse } from "@ros/contracts/auth";
import type { BranchContextDto, WorkspaceStructureDto } from "@ros/contracts/structure";
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

function renderHome(permissions: string[]) {
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
  // The page's toaster reads the colour scheme.
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 404 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpsHome consoles", () => {
  it("shows a kitchen user only the kitchen display", async () => {
    renderHome(["kitchen.view", "kitchen.update"]);
    expect(await screen.findByRole("link", { name: "Kitchen" })).toHaveAttribute(
      "href",
      `/kitchen/${BR}`,
    );
    expect(screen.queryByRole("link", { name: "Waiter" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Cashier" })).not.toBeInTheDocument();
  });

  it("shows a manager every console", async () => {
    renderHome(["orders.approve", "kitchen.view", "payments.record"]);
    for (const name of ["Waiter", "Kitchen", "Cashier"]) {
      expect(await screen.findByRole("link", { name })).toBeInTheDocument();
    }
  });

  it("says so when the role has no console at a branch", async () => {
    renderHome(["orders.view"]);
    expect(await screen.findByText("No consoles for your role here")).toBeInTheDocument();
  });
});
