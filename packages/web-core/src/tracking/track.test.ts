import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useTrackingStore } from "./consent";
import { configureGtag } from "./gtag";
import { track, trackOnce } from "./track";
import { TEST_ID, events, resetTracking, setPath } from "./test-helpers";

function optIn() {
  useTrackingStore.setState({ measurementId: TEST_ID, consent: "granted" });
  configureGtag(TEST_ID, { debug: false });
}

beforeEach(() => resetTracking());
afterEach(() => {
  resetTracking();
  vi.restoreAllMocks();
});

describe("track", () => {
  it("is inert without a Measurement ID, even with consent", () => {
    useTrackingStore.setState({ measurementId: null, consent: "granted" });
    track("workspace_created");
    expect(window.dataLayer).toBeUndefined();
  });

  it("is inert until the visitor opts in", () => {
    useTrackingStore.setState({ measurementId: TEST_ID, consent: null });
    track("workspace_created");
    useTrackingStore.setState({ consent: "denied" });
    track("workspace_created");
    expect(window.dataLayer).toBeUndefined();
  });

  it("sends a catalog event with its validated params once opted in", () => {
    optIn();
    setPath("/app");
    track("checkout_started", {
      plan_key: "pro",
      billing_cycle: "monthly",
      value: 1499,
      currency: "INR",
    });
    expect(events()).toEqual([
      {
        name: "checkout_started",
        params: { plan_key: "pro", billing_cycle: "monthly", value: 1499, currency: "INR" },
      },
    ]);
  });

  it("drops personal data and unknown events that bypass the types", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    optIn();
    track("signup_completed", {
      method: "password",
      invited: false,
      email: "owner@demo.local",
    } as never);
    track("upgrade_clicked", { plan_key: "9845012345" });
    track("purchase" as never, {} as never);
    track("order_submitted" as never, {} as never);
    expect(events()).toEqual([]);
  });

  it("never sends from a guest QR page", () => {
    optIn();
    setPath("/t/GYw3TEwFZ7bpHJOKMnagBoWJxEwV-PffDfEFKcigOg4");
    track("workspace_created");
    expect(events()).toEqual([]);
  });

  it("trackOnce sends at most once per page load, and only once active", () => {
    useTrackingStore.setState({ measurementId: TEST_ID, consent: null });
    trackOnce("signup_started", { invited: false });
    optIn();
    trackOnce("signup_started", { invited: false });
    trackOnce("signup_started", { invited: false });
    expect(events("signup_started")).toHaveLength(1);
  });
});
