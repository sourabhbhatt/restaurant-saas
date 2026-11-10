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

/** Offline, no saved account: the account request pauses until a connection returns. */
function renderOffline(offlineCapable: boolean) {
  const net = { online: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (!net.online) throw new TypeError("Failed to fetch");
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
      <AuthGate offlineCapable={offlineCapable}>
        <p>Signed-in screen</p>
      </AuthGate>
    </QueryClientProvider>,
  );
  return net;
}

describe("AuthGate offline with no saved account", () => {
  it("says so instead of loading forever, and continues once the connection returns", async () => {
    const net = renderOffline(false);
    expect(
      await screen.findByRole("heading", { name: "You're offline" }, { timeout: 4_000 }),
    ).toBeInTheDocument();
    // Owner and admin screens don't work offline: no promise that they do.
    expect(screen.getByText("Connect to the internet to continue.")).toBeInTheDocument();
    expect(screen.queryByText(/keeps working/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();

    // The connection comes back: the paused request resumes on its own.
    net.online = true;
    act(() => onlineManager.setOnline(true));
    expect(await screen.findByText("Signed-in screen", {}, { timeout: 4_000 })).toBeInTheDocument();
  });

  it("tells staff screens that one sign-in is enough to keep working offline", async () => {
    renderOffline(true);
    await screen.findByRole("heading", { name: "You're offline" }, { timeout: 4_000 });
    expect(screen.getByText(/connect once to sign in/i)).toBeInTheDocument();
    expect(screen.getByText(/keeps working when the connection drops/i)).toBeInTheDocument();
  });
});
