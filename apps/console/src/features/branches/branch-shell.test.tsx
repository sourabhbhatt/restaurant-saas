import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MeResponse } from "@ros/contracts/auth";
import type { BranchContextDto, WorkspaceStructureDto } from "@ros/contracts/structure";
import { UNLIMITED, type Entitlements } from "@ros/domain/subscriptions/entitlements";
import { sessionKeys } from "@ros/web-core/features/session/queries";

import { BranchShell } from "./branch-shell";

const WS = "11111111-1111-4111-8111-111111111111";
const BRANCH = "22222222-2222-4222-8222-222222222222";
const OTHER_BRANCH = "33333333-3333-4333-8333-333333333333";

vi.mock("next/navigation", () => ({
  useParams: () => ({ branchId: BRANCH }),
  usePathname: () => `/app/b/${BRANCH}/menu`,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const entitlements: Entitlements = {
  phase: "ACTIVE",
  accessLevel: "FULL",
  planKey: "pro",
  planName: "Pro",
  limits: UNLIMITED,
  features: [],
  trialEndsAt: null,
  trialDaysRemaining: null,
  periodEndsAt: null,
  graceEndsAt: null,
};

const me: MeResponse = {
  user: {
    id: "u1",
    email: "owner@example.in",
    name: "Priya Sharma",
    emailVerified: true,
    isPlatformAdmin: false,
  },
  activeWorkspaceId: WS,
  workspaces: [
    {
      id: WS,
      name: "Sharma Hospitality",
      slug: "sharma",
      status: "ACTIVE",
      roleKey: "workspace_owner",
      roleName: "Workspace Owner",
    },
  ],
} as MeResponse;

const structure: WorkspaceStructureDto = {
  workspaceId: WS,
  workspaceName: "Sharma Hospitality",
  roleKey: "workspace_owner",
  roleLabel: "Workspace Owner",
  permissions: ["menu.view", "tables.view", "orders.view"],
  entitlements,
  restaurants: [
    {
      id: "r1",
      name: "Dosa Corner",
      status: "ACTIVE",
      logoKey: null,
      branches: [
        { id: BRANCH, name: "Koregaon Park", code: "KP", city: "Pune", status: "ACTIVE" },
        { id: OTHER_BRANCH, name: "Baner", code: "BN", city: "Pune", status: "ACTIVE" },
      ],
    },
  ],
};

function branchContext(overrides: Partial<BranchContextDto> = {}): BranchContextDto {
  return {
    workspaceId: WS,
    workspaceName: "Sharma Hospitality",
    restaurantId: "r1",
    restaurantName: "Dosa Corner",
    branchId: BRANCH,
    branchName: "Koregaon Park",
    currency: "INR",
    timezone: "Asia/Kolkata",
    roleLabel: "Workspace Owner",
    permissions: ["menu.view", "tables.view", "orders.view"],
    entitlements,
    ...overrides,
  };
}

function renderShell(ctx: BranchContextDto, ws: WorkspaceStructureDto = structure) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(sessionKeys.me, me);
  qc.setQueryData(sessionKeys.branchContext(BRANCH), ctx);
  qc.setQueryData(sessionKeys.structure(WS), ws);
  return render(
    <QueryClientProvider client={qc}>
      <BranchShell>
        <p>Menu page</p>
      </BranchShell>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // Anything not seeded above (notifications, announcements) is simply absent.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 }),
    ),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BranchShell sidebar", () => {
  it("names the workspace in the sidebar header inside a branch route, not the branch", async () => {
    renderShell(branchContext());
    const sidebar = await screen.findByRole("complementary");

    const workspace = within(sidebar).getByRole("button", { name: /^Workspace / });
    expect(workspace).toHaveAccessibleName("Workspace Sharma Hospitality. Switch workspace");
    expect(workspace).toHaveTextContent("Sharma Hospitality");
    expect(workspace).not.toHaveTextContent("Koregaon Park");
    expect(workspace).not.toHaveTextContent("Dosa Corner");

    // The branch is its own, secondary control below the workspace.
    const branch = within(sidebar).getByRole("button", { name: /^Branch / });
    expect(branch).toHaveTextContent("Dosa Corner");
    expect(branch).toHaveTextContent("Koregaon Park");
    expect(screen.getByText("Menu page")).toBeInTheDocument();
  });

  it("keeps the workspace name when the branch's own copy of it is stale", async () => {
    // A branch context cached before the workspace was renamed (or restored
    // from the offline cache) must not change what the sidebar calls the workspace.
    renderShell(branchContext({ workspaceName: "Koregaon Park" }));
    const sidebar = await screen.findByRole("complementary");
    const workspace = within(sidebar).getByRole("button", { name: /^Workspace / });
    expect(workspace).toHaveAccessibleName("Workspace Sharma Hospitality. Switch workspace");
    expect(workspace).not.toHaveTextContent("Koregaon Park");

    // The account menu names the same workspace.
    await userEvent.click(screen.getByRole("button", { name: "PS Priya Sharma, account menu" }));
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText(/Sharma Hospitality/)).toBeInTheDocument();
    expect(within(menu).getByText("Dosa Corner · Koregaon Park")).toBeInTheDocument();
    // Help is one tap away from every screen.
    expect(within(menu).getByRole("menuitem", { name: /Help & support/ })).toHaveAttribute(
      "href",
      `http://localhost:3000/app/w/${WS}/support`,
    );
  });

  it("shows the full workspace name on hover when it is truncated", async () => {
    const long = "Sharma Hospitality and Catering Services Private Limited";
    renderShell(branchContext({ workspaceName: long }), { ...structure, workspaceName: long });
    const sidebar = await screen.findByRole("complementary");
    const workspace = within(sidebar).getByRole("button", { name: /^Workspace / });
    expect(workspace).toHaveAttribute("title", long);
  });
});
