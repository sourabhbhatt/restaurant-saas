import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MeResponse } from "@ros/contracts/auth";
import { sessionKeys } from "@ros/web-core/features/session/queries";

import { OnboardingWizard } from "./onboarding-wizard";

const WS = "11111111-1111-4111-8111-111111111111";
const R1 = "22222222-2222-4222-8222-222222222222";
const B1 = "33333333-3333-4333-8333-333333333333";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  usePathname: () => "/app/onboarding",
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const me = {
  user: { id: "u1", email: "o@example.in", name: "Priya", emailVerified: true },
  activeWorkspaceId: WS,
  workspaces: [{ id: WS, name: "Sharma Foods", slug: "s", status: "ACTIVE" }],
} as unknown as MeResponse;

type Reply = { status: number; body: unknown };
type Handler = (body: unknown) => Reply | Promise<Reply>;

function mockApi(routes: Record<string, Handler>) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url, "http://localhost").pathname;
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ method, path, body });
      const handler = routes[`${method} ${path}`];
      const res = handler ? await handler(body) : { status: 404, body: {} };
      return new Response(JSON.stringify(res.body), {
        status: res.status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

const ok = (data: unknown) => () => ({ status: 200, body: { data } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OnboardingWizard restaurant step", () => {
  it("shows a branch error under the branch field and does not create the restaurant twice", async () => {
    let branchAttempts = 0;
    const calls = mockApi({
      [`GET /api/v1/workspaces/${WS}`]: ok({
        workspace: {
          id: WS,
          onboarding: { completedSteps: ["business"], restaurantId: null, branchId: null },
        },
      }),
      [`POST /api/v1/workspaces/${WS}/restaurants`]: ok({ id: R1, name: "Dosa Corner" }),
      [`POST /api/v1/restaurants/${R1}/branches`]: () => {
        branchAttempts += 1;
        return branchAttempts === 1
          ? {
              status: 400,
              body: {
                error: {
                  code: "VALIDATION_FAILED",
                  message: "Check the highlighted fields",
                  fieldErrors: { name: ["A branch with this name already exists"] },
                },
              },
            }
          : { status: 200, body: { data: { id: B1, name: "Baner" } } };
      },
      [`PUT /api/v1/workspaces/${WS}/onboarding`]: ok({}),
    });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    qc.setQueryData(sessionKeys.me, me);
    render(
      <QueryClientProvider client={qc}>
        <OnboardingWizard />
      </QueryClientProvider>,
    );

    const restaurant = await screen.findByLabelText(/Restaurant name/);
    await userEvent.type(restaurant, "Dosa Corner");
    await userEvent.click(screen.getByRole("button", { name: "Create restaurant and branch" }));

    const branch = screen.getByLabelText(/First branch name/);
    await waitFor(() => expect(branch).toHaveAccessibleDescription(/already exists/));
    expect(screen.getByLabelText(/Restaurant name/)).not.toHaveAccessibleDescription(
      /already exists/,
    );
    expect(screen.getByLabelText(/Restaurant name/)).toBeDisabled();

    await userEvent.clear(branch);
    await userEvent.type(branch, "Baner");
    await userEvent.click(screen.getByRole("button", { name: "Create branch" }));

    await screen.findByRole("heading", { name: /Add your first dish/ });
    const created = calls.filter(
      (c) => c.method === "POST" && c.path === `/api/v1/workspaces/${WS}/restaurants`,
    );
    expect(created).toHaveLength(1);
    expect(branchAttempts).toBe(2);
  });
});

describe("OnboardingWizard last step", () => {
  it("hands over to the dashboard checklist instead of hiding it", async () => {
    const calls = mockApi({
      [`GET /api/v1/workspaces/${WS}`]: ok({
        workspace: {
          id: WS,
          onboarding: {
            completedSteps: ["business", "branch", "menu", "tables"],
            restaurantId: R1,
            branchId: B1,
          },
        },
      }),
      [`PUT /api/v1/workspaces/${WS}/onboarding`]: ok({}),
    });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    qc.setQueryData(sessionKeys.me, me);
    render(
      <QueryClientProvider client={qc}>
        <OnboardingWizard />
      </QueryClientProvider>,
    );

    await screen.findByRole("heading", { name: "Your restaurant is set up" });
    expect(screen.getByRole("link", { name: "Print QR codes" })).toHaveAttribute(
      "href",
      `/print/tables?branchId=${B1}`,
    );
    await userEvent.click(screen.getByRole("button", { name: "Go to my dashboard" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/app/b/${B1}`));
    expect(calls).toContainEqual({
      method: "PUT",
      path: `/api/v1/workspaces/${WS}/onboarding`,
      body: { completedStep: "done" },
    });
  });
});

describe("OnboardingWizard tables step", () => {
  it("gives every new table its QR code, and a failed code does not block setup", async () => {
    const TA = "44444444-4444-4444-8444-444444444444";
    const TB = "55555555-5555-4555-8555-555555555555";
    const calls = mockApi({
      [`GET /api/v1/workspaces/${WS}`]: ok({
        workspace: {
          id: WS,
          onboarding: {
            completedSteps: ["business", "branch", "menu"],
            restaurantId: R1,
            branchId: B1,
          },
        },
      }),
      [`PUT /api/v1/workspaces/${WS}/onboarding`]: ok({}),
      [`POST /api/v1/branches/${B1}/tables/bulk`]: () => ({
        status: 201,
        body: {
          data: [
            { id: TA, name: "T1" },
            { id: TB, name: "T2" },
          ],
        },
      }),
      [`POST /api/v1/tables/${TA}/qr`]: ok({ tableId: TA, url: "http://localhost/t/a" }),
      [`POST /api/v1/tables/${TB}/qr`]: () => ({
        status: 500,
        body: { error: { code: "INTERNAL", message: "boom" } },
      }),
    });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    qc.setQueryData(sessionKeys.me, me);
    render(
      <QueryClientProvider client={qc}>
        <OnboardingWizard />
      </QueryClientProvider>,
    );

    const count = await screen.findByLabelText(/How many/);
    await userEvent.clear(count);
    await userEvent.type(count, "2");
    await userEvent.click(screen.getByRole("button", { name: "Create 2 tables" }));

    await screen.findByRole("heading", { name: "Your restaurant is set up" });
    const qrPosts = calls.filter((c) => c.method === "POST" && c.path.endsWith("/qr"));
    expect(qrPosts.map((c) => c.path)).toEqual([
      `/api/v1/tables/${TA}/qr`,
      `/api/v1/tables/${TB}/qr`,
    ]);
  });
});

describe("OnboardingWizard QR codes for many tables", () => {
  it("creates them a few at a time and shows progress", async () => {
    const ids = Array.from(
      { length: 10 },
      (_, i) => `66666666-6666-4666-8666-${String(i).padStart(12, "0")}`,
    );
    let inFlight = 0;
    let maxInFlight = 0;
    const qrRoutes = Object.fromEntries(
      ids.map((id) => [
        `POST /api/v1/tables/${id}/qr`,
        async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 40));
          inFlight -= 1;
          return { status: 200, body: { data: { tableId: id, url: "http://localhost/t/x" } } };
        },
      ]),
    );
    const calls = mockApi({
      [`GET /api/v1/workspaces/${WS}`]: ok({
        workspace: {
          id: WS,
          onboarding: {
            completedSteps: ["business", "branch", "menu"],
            restaurantId: R1,
            branchId: B1,
          },
        },
      }),
      [`PUT /api/v1/workspaces/${WS}/onboarding`]: ok({}),
      [`POST /api/v1/branches/${B1}/tables/bulk`]: () => ({
        status: 201,
        body: { data: ids.map((id, i) => ({ id, name: `T${i + 1}` })) },
      }),
      ...qrRoutes,
    });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    qc.setQueryData(sessionKeys.me, me);
    render(
      <QueryClientProvider client={qc}>
        <OnboardingWizard />
      </QueryClientProvider>,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Create 10 tables" }));
    expect(await screen.findByText(/Generating QR codes \d+\/10/)).toBeInTheDocument();
    await screen.findByRole("heading", { name: "Your restaurant is set up" });

    expect(calls.filter((c) => c.method === "POST" && c.path.endsWith("/qr"))).toHaveLength(10);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(4);
  });
});
