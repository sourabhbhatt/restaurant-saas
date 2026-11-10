import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NotificationBell } from "./notification-bell";

const ws = "11111111-1111-4111-8111-111111111111";
const br = "22222222-2222-4222-8222-222222222222";

function mockApi(routes: Record<string, unknown>) {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url, "http://localhost").pathname;
      calls.push({
        url,
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const data = routes[`${init?.method ?? "GET"} ${path}`];
      if (data === undefined) return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ data }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

function renderBell() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotificationBell workspaceId={ws} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("NotificationBell", () => {
  it("shows the unread badge, lists items with deep links and marks read", async () => {
    const calls = mockApi({
      "GET /api/v1/notifications": {
        items: [
          {
            id: "33333333-3333-4333-8333-333333333333",
            type: "order.created",
            title: "New order at table 4",
            body: "2 items",
            data: { orderId: "x" },
            workspaceId: ws,
            branchId: br,
            readAt: null,
            createdAt: new Date().toISOString(),
          },
        ],
        nextCursor: null,
        unreadCount: 1,
      },
      "GET /api/v1/push/config": { enabled: false, publicKey: null },
      "POST /api/v1/notifications/read": { updated: 1, unreadCount: 0 },
    });
    renderBell();
    const trigger = await screen.findByRole("button", { name: "Notifications, 1 unread" });
    expect(calls[0]!.url).toContain(`workspaceId=${ws}`);

    await userEvent.click(trigger);
    const link = await screen.findByRole("link", { name: /New order at table 4/ });
    // The waiter screen is in the ops app, not the console.
    expect(link).toHaveAttribute("href", `http://localhost:3001/waiter/${br}`);
    expect(screen.getByRole("link", { name: "View all notifications" })).toHaveAttribute(
      "href",
      "/app/notifications",
    );
    // Push is disabled on the server: no opt-in button at all.
    expect(screen.queryByRole("button", { name: /browser notifications/i })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() =>
      expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/notifications/read"))).toBe(
        true,
      ),
    );
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.body).toEqual({ all: true, workspaceId: ws });
  });

  it("shows an empty state", async () => {
    mockApi({
      "GET /api/v1/notifications": { items: [], nextCursor: null, unreadCount: 0 },
      "GET /api/v1/push/config": { enabled: false, publicKey: null },
    });
    renderBell();
    await userEvent.click(await screen.findByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
  });
});
