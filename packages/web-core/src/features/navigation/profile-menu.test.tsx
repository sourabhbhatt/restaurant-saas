import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_APP_LINKS, SetAppLinks } from "../../app-links";
import { sessionKeys } from "../session/queries";
import { ProfileMenu } from "./profile-menu";

vi.mock("next/navigation", () => ({
  usePathname: () => "/waiter/b1",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const WS = "11111111-1111-4111-8111-111111111111";

async function openMenu(consoleOrigin: string) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  qc.setQueryData(sessionKeys.me, {
    user: { id: "u1", email: "o@example.in", name: "Priya Sharma", emailVerified: true },
    activeWorkspaceId: WS,
    workspaces: [{ id: WS, name: "Sharma Foods", roleName: "Owner" }],
  });
  qc.setQueryData(sessionKeys.structure(WS), {
    workspaceId: WS,
    workspaceName: "Sharma Foods",
    permissions: ["workspace.support.manage"],
    restaurants: [],
  });
  render(
    <QueryClientProvider client={qc}>
      <SetAppLinks links={{ ...DEFAULT_APP_LINKS, console: consoleOrigin }} />
      <ProfileMenu workspaceId={WS} workspaceName="Sharma Foods" />
    </QueryClientProvider>,
  );
  await userEvent.click(await screen.findByRole("button", { name: /account menu/ }));
  return screen.findByRole("menu");
}

describe("ProfileMenu Help & support", () => {
  it("from the staff app, opens the owner console's support page in a new tab and says so", async () => {
    const menu = await openMenu("https://console.restaurantos.example");
    const help = within(menu).getByRole("menuitem", { name: /Help & support/ });
    expect(help).toHaveAttribute(
      "href",
      `https://console.restaurantos.example/app/w/${WS}/support`,
    );
    expect(help).toHaveAttribute("target", "_blank");
    expect(help).toHaveAttribute("rel", "noopener noreferrer");
    // Visible and announced: it is another app (and, in production, another sign-in).
    expect(help).toHaveTextContent("Opens the owner console");
    expect(help).toHaveAccessibleName(expect.stringMatching(/opens in a new tab/));
  });

  it("inside the console, stays in the same tab", async () => {
    const menu = await openMenu(window.location.origin);
    const help = within(menu).getByRole("menuitem", { name: /Help & support/ });
    expect(help).toHaveAttribute("href", `${window.location.origin}/app/w/${WS}/support`);
    expect(help).not.toHaveAttribute("target");
    expect(help).not.toHaveTextContent("Opens the owner console");
  });
});
