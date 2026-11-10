import { afterEach, describe, expect, it, vi } from "vitest";

import { TrackingConfig } from "./tracking";
import { TrackingClient } from "./tracking-client";

vi.mock("next/server", () => ({ connection: async () => {} }));

afterEach(() => {
  delete process.env.GA_MEASUREMENT_ID;
  delete process.env.GA_DEBUG_MODE;
  vi.restoreAllMocks();
});

describe("Tracking (server side of the root layout)", () => {
  it("renders nothing when GA_MEASUREMENT_ID is unset: no banner, no script, no request", async () => {
    expect(await TrackingConfig()).toBeNull();
    expect(window.dataLayer).toBeUndefined();
  });

  it("renders nothing for a value that is not a GA4 Measurement ID", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.GA_MEASUREMENT_ID = "UA-12345-1";
    expect(await TrackingConfig()).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("hands the configured stream to the client, with DebugView only when asked", async () => {
    process.env.GA_MEASUREMENT_ID = "G-STAGING01";
    process.env.GA_DEBUG_MODE = "true";
    const el = await TrackingConfig();
    expect(el?.type).toBe(TrackingClient);
    expect(el?.props).toEqual({ measurementId: "G-STAGING01", debug: true });
  });
});
