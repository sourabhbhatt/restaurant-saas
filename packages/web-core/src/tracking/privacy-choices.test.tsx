import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthShell } from "../features/auth/auth-shell";
import { ProfileMenu } from "../features/navigation/profile-menu";
import { useTrackingStore } from "./consent";
import { PrivacyChoicesLink } from "./privacy-choices";
import { TEST_ID, resetTracking, setConsentCookie } from "./test-helpers";
import { TrackingClient } from "./tracking-client";

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
vi.mock("next/navigation", () => ({ usePathname: () => "/app/account" }));
vi.mock("next/script", () => ({ default: () => null }));

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

/** Keyboard and screen-reader users must land on the banner they just reopened. */
describe("reopening the choice", () => {
  const heading = () => screen.getByRole("heading", { name: "Help us improve RestaurantOS?" });
  const tracker = <TrackingClient measurementId={TEST_ID} debug={false} />;

  it("moves focus to the banner when opened from the account menu", async () => {
    setConsentCookie("granted");
    render(
      <>
        {tracker}
        <ProfileMenu />
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: /account menu/i }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Cookie settings" }));
    await waitFor(() => expect(heading()).toHaveFocus());
  });

  it("moves focus to the banner when opened from a footer link", async () => {
    setConsentCookie("granted");
    render(
      <>
        {tracker}
        <PrivacyChoicesLink />
      </>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Cookie settings" }));
    await waitFor(() => expect(heading()).toHaveFocus());
  });

  it("does not take focus when the banner first appears on a page", async () => {
    render(tracker);
    expect(await screen.findByTestId("analytics-consent")).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.body).toHaveFocus();
  });
});
