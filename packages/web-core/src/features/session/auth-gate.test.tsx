import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthGate } from "./auth-gate";

vi.mock("next/navigation", () => ({
  usePathname: () => "/waiter/b1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

const me = {
  user: { id: "u1", email: "w@example.in", name: "Wasim", emailVerified: true },
  activeWorkspaceId: null,
  workspaces: [],
};

afterEach(() => {
  onlineManager.setOnline(true);
  vi.unstubAllGlobals();
});

describe("AuthGate", () => {
  it("explains that a first sign-in needs a connection instead of loading forever", async () => {
    let online = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (!online) throw new TypeError("Failed to fetch");
        return new Response(JSON.stringify({ data: me }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    onlineManager.setOnline(false);
    // Same network mode as the app's query client: try once, then wait for a connection.
    const qc = new QueryClient({ defaultOptions: { queries: { networkMode: "offlineFirst" } } });
    render(
      <QueryClientProvider client={qc}>
        <AuthGate>
          <p>Waiter console</p>
        </AuthGate>
      </QueryClientProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "You're offline" }, { timeout: 4_000 }),
    ).toBeInTheDocument();
    expect(screen.getByText(/connect once to sign in/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();

    // The connection comes back: the paused request resumes on its own.
    online = true;
    act(() => onlineManager.setOnline(true));
    expect(await screen.findByText("Waiter console", {}, { timeout: 4_000 })).toBeInTheDocument();
  });
});
