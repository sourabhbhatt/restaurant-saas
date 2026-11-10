import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthShell } from "../features/auth/auth-shell";
import { ProfileMenu } from "../features/navigation/profile-menu";
import { useTrackingStore } from "./consent";
import { TEST_ID, resetTracking } from "./test-helpers";

vi.mock("../features/session/queries", () => ({
  useIdentity: () => ({
    user: { name: "Asha Rao", email: "asha@example.com" },
    workspaces: [],
    ready: true,
  }),
  useSignOut: () => () => {},
}));
vi.mock("../features/workspaces/use-switch-workspace", () => ({
  useSwitchWorkspace: () => () => {},
}));
// The toast host needs matchMedia, which jsdom lacks; it plays no part here.
vi.mock("@ros/ui/ui/sonner", () => ({ Toaster: () => null }));

beforeEach(() => resetTracking());
afterEach(() => resetTracking());

async function openAccountMenu() {
  render(<ProfileMenu />);
  await userEvent.click(screen.getByRole("button", { name: /account menu/i }));
}

/**
 * The banner can be accepted on the public site, the auth pages and inside the
 * app; "Cookie settings" must be one click away on each (DPDP: withdrawing is
 * as easy as consenting). The public site has it in SiteFooter.
 */
describe("Cookie settings wherever the banner can be accepted", () => {
  it("is in the auth pages' footer", async () => {
    useTrackingStore.setState({ measurementId: TEST_ID });
    render(
      <AuthShell>
        <p>form</p>
      </AuthShell>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cookie settings" }));
    expect(useTrackingStore.getState().settingsOpen).toBe(true);
  });

  it("is in the account menu of every dashboard and the account page", async () => {
    useTrackingStore.setState({ measurementId: TEST_ID });
    await openAccountMenu();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Cookie settings" }));
    expect(useTrackingStore.getState().settingsOpen).toBe(true);
  });

  it("is absent without a Measurement ID (ops, admin, unconfigured environments)", async () => {
    render(
      <AuthShell>
        <p>form</p>
      </AuthShell>,
    );
    expect(screen.queryByRole("button", { name: "Cookie settings" })).toBeNull();
    await openAccountMenu();
    expect(await screen.findByRole("menuitem", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Cookie settings" })).toBeNull();
  });
});
