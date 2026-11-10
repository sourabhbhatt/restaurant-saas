import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANALYTICS_CONSENT_COOKIE } from "@ros/contracts/tracking-events";

import { CONSENT_CHANNEL, useTrackingStore } from "./consent";
import { PrivacyChoicesLink } from "./privacy-choices";
import { track } from "./track";
import { TrackingClient } from "./tracking-client";
import {
  TEST_ID,
  commands,
  events,
  resetTracking,
  setConsentCookie,
  setPath,
} from "./test-helpers";

const nav = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
// Stand-in for next/script: records what would load, never fetches anything.
vi.mock("next/script", () => ({
  default: ({ src }: { src: string }) => <span data-testid="gtag-script" data-src={src} />,
}));

const UUID = "0b3c6c2e-5d0e-4f43-9d55-0a4c3f0e5c11";

function go(path: string) {
  nav.pathname = path.split("?")[0]!;
  setPath(path);
}

function ui() {
  return (
    <>
      <TrackingClient measurementId={TEST_ID} debug={false} />
      <PrivacyChoicesLink />
    </>
  );
}

beforeEach(() => {
  resetTracking();
  go("/");
});
afterEach(() => resetTracking());

describe("before any choice", () => {
  it("shows a banner with equally weighted choices and loads nothing", () => {
    render(ui());
    const decline = screen.getByRole("button", { name: "Decline" });
    const allow = screen.getByRole("button", { name: "Allow analytics" });
    expect(decline.className).toBe(allow.className);
    expect(screen.queryByTestId("gtag-script")).toBeNull();
    expect(window.dataLayer).toBeUndefined();

    track("signup_started", { invited: false });
    expect(window.dataLayer).toBeUndefined();
  });

  it("never shows the banner or the tag on guest QR, print and dev pages", () => {
    for (const path of ["/t/GYw3TEwFZ7bpHJOKMnagBoWJxEwV-PffDfEFKcigOg4", "/print/tables"]) {
      go(path);
      const { unmount } = render(ui());
      expect(screen.queryByTestId("analytics-consent")).toBeNull();
      expect(screen.queryByTestId("gtag-script")).toBeNull();
      unmount();
    }
  });
});

describe("declining", () => {
  it("stores the choice, removes GA cookies and keeps the tag unloaded", async () => {
    document.cookie = "_ga=GA1.1.123.1700000000; Path=/";
    render(ui());
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));

    expect(document.cookie).toContain(`${ANALYTICS_CONSENT_COOKIE}=denied`);
    expect(document.cookie).not.toContain("_ga=");
    expect(screen.queryByTestId("analytics-consent")).toBeNull();
    expect(screen.queryByTestId("gtag-script")).toBeNull();
    expect(window.dataLayer).toBeUndefined();
    track("signup_started", { invited: false });
    expect(window.dataLayer).toBeUndefined();
  });
});

describe("allowing", () => {
  it("queues Consent Mode defaults (all denied) before config, then loads gtag.js once", async () => {
    render(ui());
    await userEvent.click(screen.getByRole("button", { name: "Allow analytics" }));

    expect(screen.getByTestId("gtag-script").dataset.src).toBe(
      `https://www.googletagmanager.com/gtag/js?id=${TEST_ID}`,
    );
    const cmds = commands();
    const defaults = cmds.findIndex((c) => c[0] === "consent" && c[1] === "default");
    const config = cmds.findIndex((c) => c[0] === "config");
    expect(defaults).toBe(0);
    expect(cmds[defaults]![2]).toEqual({
      ad_storage: "denied",
      ad_user_data: "denied",
      ad_personalization: "denied",
      analytics_storage: "denied",
    });
    expect(cmds.slice(0, config)).toContainEqual([
      "consent",
      "update",
      { analytics_storage: "granted" },
    ]);
    expect(cmds[config]).toEqual([
      "config",
      TEST_ID,
      expect.objectContaining({
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      }),
    ]);
    // The page the visitor consented on is counted once.
    expect(events("page_view")).toHaveLength(1);
    expect(document.cookie).toContain(`${ANALYTICS_CONSENT_COOKIE}=granted`);
  });
});

describe("page views", () => {
  it("sends exactly one page_view per route change, never for re-renders or Strict Mode", () => {
    setConsentCookie("granted");
    go("/pricing?utm_source=newsletter&email=asha%40example.com");
    // A title left over from the previous route (e.g. a restaurant's name) never reaches GA.
    document.title = "Spice Garden · Menu";
    const { rerender } = render(<StrictMode>{ui()}</StrictMode>);
    rerender(<StrictMode>{ui()}</StrictMode>);
    expect(events("page_view")).toHaveLength(1);

    go("/features");
    rerender(<StrictMode>{ui()}</StrictMode>);
    rerender(<StrictMode>{ui()}</StrictMode>);
    go(`/app/w/${UUID}/subscription`);
    rerender(<StrictMode>{ui()}</StrictMode>);

    const views = events("page_view").map((e) => e.params);
    expect(views.map((v) => v.page_location)).toEqual([
      "http://localhost:3000/pricing?utm_source=newsletter",
      "http://localhost:3000/features",
      "http://localhost:3000/app/w/:id/subscription",
    ]);
    expect(views.map((v) => v.content_group)).toEqual(["marketing", "marketing", "product"]);
    expect(views[1]!.page_referrer).toBe("http://localhost:3000/pricing?utm_source=newsletter");
    // Titles can name a restaurant (and can lag a navigation); every title is the sanitized path.
    expect(views.map((v) => v.page_title)).toEqual([
      "/pricing",
      "/features",
      "/app/w/:id/subscription",
    ]);
    expect(JSON.stringify(commands())).not.toContain("Spice Garden");
    expect(JSON.stringify(commands())).not.toContain(UUID);
    expect(JSON.stringify(commands())).not.toContain("asha");
  });

  it("does not repeat the page_view when the tracker remounts or consent is re-given on the same route", async () => {
    setConsentCookie("granted");
    go("/pricing");
    const first = render(ui());
    first.unmount();
    render(ui());
    expect(events("page_view")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Cookie settings" }));
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));
    await userEvent.click(screen.getByRole("button", { name: "Cookie settings" }));
    await userEvent.click(screen.getByRole("button", { name: "Allow analytics" }));
    expect(events("page_view")).toHaveLength(1);
  });

  it("marks the first marketing page of a tab session as the landing page, once", () => {
    setConsentCookie("granted");
    go("/pricing");
    const { rerender } = render(ui());
    go("/features");
    rerender(ui());
    expect(events("landing_page_view")).toEqual([
      { name: "landing_page_view", params: { landing_page: "/pricing" } },
    ]);
  });
});

describe("changing the choice later", () => {
  it("reopens from the footer link and a withdrawal stops every further hit", async () => {
    setConsentCookie("granted");
    document.cookie = "_ga=GA1.1.123.1700000000; Path=/";
    render(ui());
    expect(screen.queryByTestId("analytics-consent")).toBeNull();
    expect(events("page_view")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Cookie settings" }));
    expect(screen.getByTestId("analytics-consent")).toHaveTextContent("Current choice: allowed");
    await userEvent.click(screen.getByRole("button", { name: "Decline" }));

    expect(window[`ga-disable-${TEST_ID}`]).toBe(true);
    expect(commands().at(-1)).toEqual(["consent", "update", { analytics_storage: "denied" }]);
    expect(document.cookie).not.toContain("_ga=");
    const before = commands().length;
    act(() => track("upgrade_clicked", {}));
    expect(commands()).toHaveLength(before);
  });
});

describe("a choice made in another tab", () => {
  /** What another tab does on Decline/Allow: write the shared cookie, then announce it. */
  function otherTabChooses(choice: "granted" | "denied") {
    setConsentCookie(choice);
    const channel = new BroadcastChannel(CONSENT_CHANNEL);
    channel.postMessage("changed");
    channel.close();
  }

  it("a withdrawal stops this tab at once and removes the GA cookies its tag wrote", async () => {
    setConsentCookie("granted");
    render(ui());
    expect(events("page_view")).toHaveLength(1);
    document.cookie = "_ga=GA1.1.123.1700000000; Path=/";

    otherTabChooses("denied");

    await waitFor(() => expect(window[`ga-disable-${TEST_ID}`]).toBe(true));
    expect(commands().at(-1)).toEqual(["consent", "update", { analytics_storage: "denied" }]);
    expect(document.cookie).not.toContain("_ga=");
    const before = commands().length;
    act(() => track("upgrade_clicked", {}));
    go("/features");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(commands()).toHaveLength(before);
  });

  it("is picked up when this tab is shown again, without a message", () => {
    setConsentCookie("granted");
    render(ui());
    setConsentCookie("denied");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(window[`ga-disable-${TEST_ID}`]).toBe(true);
    expect(useTrackingStore.getState().consent).toBe("denied");
  });

  it("stops this tab's own events even before it hears about the withdrawal", () => {
    setConsentCookie("granted");
    render(ui());
    setConsentCookie("denied");
    const before = commands().length;
    track("upgrade_clicked", {});
    expect(commands()).toHaveLength(before);
  });

  it("an opt-in elsewhere closes this tab's banner and starts the tag", async () => {
    render(ui());
    expect(screen.getByTestId("analytics-consent")).toBeInTheDocument();
    otherTabChooses("granted");
    await waitFor(() => expect(screen.queryByTestId("analytics-consent")).toBeNull());
    expect(screen.getByTestId("gtag-script")).toBeInTheDocument();
    expect(events("page_view")).toHaveLength(1);
  });

  it("announces this tab's choice to the others", async () => {
    const heard: unknown[] = [];
    const listener = new BroadcastChannel(CONSENT_CHANNEL);
    listener.onmessage = (e) => heard.push(e.data);
    try {
      render(ui());
      await userEvent.click(screen.getByRole("button", { name: "Decline" }));
      await waitFor(() => expect(heard).toEqual(["changed"]));
    } finally {
      listener.close();
    }
  });
});

describe("without a Measurement ID", () => {
  it("the footer link renders nothing", () => {
    render(<PrivacyChoicesLink />);
    expect(screen.queryByRole("button", { name: "Cookie settings" })).toBeNull();
  });
});
