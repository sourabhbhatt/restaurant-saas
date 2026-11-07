import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceUsageDto } from "@ros/contracts/platform";
import type { RestaurantListItemDto } from "@ros/contracts/tenancy";
import type { WorkspaceStructureDto } from "@ros/contracts/structure";
import { makeEntitlements, makeUsage } from "@ros/web-core/features/subscriptions/limits.fixtures";

import { RestaurantsPage } from "./restaurants-page";

const ws = "11111111-1111-4111-8111-111111111111";

vi.mock("next/navigation", () => ({
  useParams: () => ({ workspaceId: ws }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => `/app/w/${ws}/restaurants`,
}));

function restaurant(i: number): RestaurantListItemDto {
  return {
    id: `00000000-0000-4000-8000-00000000000${i}`,
    workspaceId: ws,
    name: `Restaurant ${i}`,
    slug: `restaurant-${i}`,
    description: null,
    cuisineTypes: [],
    logoKey: null,
    coverKey: null,
    contactEmail: null,
    contactPhone: null,
    website: null,
    brandColor: null,
    status: "ACTIVE",
    version: 1,
    branches: [],
  } as unknown as RestaurantListItemDto;
}

function mockApi(opts: { restaurants: number; usage: Partial<WorkspaceUsageDto> }) {
  const structure = {
    workspaceId: ws,
    workspaceName: "Saffron Hospitality",
    roleKey: "workspace_owner",
    roleLabel: "Workspace Owner",
    permissions: ["workspace.view", "restaurant.create", "branch.create"],
    restaurants: [],
    entitlements: makeEntitlements(),
  } satisfies WorkspaceStructureDto;
  const routes: Record<string, unknown> = {
    [`/api/v1/workspaces/${ws}/structure`]: structure,
    [`/api/v1/workspaces/${ws}/restaurants`]: Array.from({ length: opts.restaurants }, (_, i) =>
      restaurant(i + 1),
    ),
    [`/api/v1/workspaces/${ws}/entitlements`]: {
      entitlements: makeEntitlements(),
      usage: makeUsage(opts.usage),
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const data = routes[new URL(url, "http://localhost").pathname];
      if (data === undefined) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RestaurantsPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RestaurantsPage plan limits", () => {
  it("disables Create restaurant at the limit and says why, next to the button", async () => {
    mockApi({ restaurants: 3, usage: { restaurants: 3, branches: 3 } });
    renderPage();

    await screen.findByText("Restaurant 3");
    const create = await screen.findByRole("button", { name: /Create restaurant/ });
    await vi.waitFor(() => expect(create).toBeDisabled());
    expect(create).toHaveAccessibleDescription(
      "You've reached the 3-restaurant limit of your plan. Upgrade to add more.",
    );

    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent("Restaurants limit reached");
    expect(notice).toHaveTextContent("3 of 3 restaurants used on Pro");
    expect(within(notice).getByRole("link", { name: "Compare plans and upgrade" })).toHaveAttribute(
      "href",
      `/app/w/${ws}/subscription`,
    );
  });

  it("keeps Create restaurant enabled below the limit and shows the meter", async () => {
    mockApi({ restaurants: 2, usage: { restaurants: 2, branches: 2 } });
    renderPage();

    await screen.findByText("Restaurant 2");
    expect(await screen.findByText("2 of 3 restaurants used on Pro")).toBeInTheDocument();
    const create = screen.getByRole("button", { name: /Create restaurant/ });
    expect(create).toBeEnabled();
    expect(create).not.toHaveAttribute("aria-describedby");

    await userEvent.click(create);
    expect(await screen.findByRole("dialog", { name: "Create restaurant" })).toBeInTheDocument();
  });

  it("explains workspace, restaurant and branch with the plan's numbers", async () => {
    mockApi({ restaurants: 1, usage: { restaurants: 1 } });
    renderPage();

    const about = await screen.findByRole("region", { name: "About restaurants and branches" });
    expect(about).toHaveTextContent("Workspace is your business account");
    expect(about).toHaveTextContent("Restaurant is a brand or concept");
    expect(about).toHaveTextContent("Branch is a physical location");
    expect(
      await within(about).findByText(/up to 3 restaurants, 10 branches, 200 tables/),
    ).toBeInTheDocument();
  });

  it("disables Add branch when the workspace-wide branch limit is used up", async () => {
    mockApi({ restaurants: 2, usage: { restaurants: 2, branches: 10 } });
    renderPage();

    await screen.findByText("Restaurant 1");
    await vi.waitFor(() => {
      const buttons = screen.getAllByRole("button", { name: /Add branch/ });
      expect(buttons).toHaveLength(2);
      for (const b of buttons) expect(b).toBeDisabled();
    });
    expect(
      screen.getAllByText("You've reached the 10-branch limit of your plan. Upgrade to add more."),
    ).toHaveLength(2);
  });
});
