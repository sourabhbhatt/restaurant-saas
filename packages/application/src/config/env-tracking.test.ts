import { afterEach, describe, expect, it } from "vitest";

import { getEnv, resetEnvCache } from "./env";

afterEach(() => {
  for (const key of ["TRACKING_PROVIDER", "GA_MEASUREMENT_ID", "GA_API_SECRET"])
    delete process.env[key];
  resetEnvCache();
});

describe("server tracking configuration", () => {
  it("is off by default: no provider, no Measurement ID", () => {
    const env = getEnv();
    expect(env.TRACKING_PROVIDER).toBe("none");
    expect(env.GA_MEASUREMENT_ID).toBeUndefined();
    expect(env.GA_API_SECRET).toBeUndefined();
  });

  it("treats blank values as unset", () => {
    process.env.GA_MEASUREMENT_ID = "";
    process.env.GA_API_SECRET = "";
    resetEnvCache();
    expect(getEnv().GA_MEASUREMENT_ID).toBeUndefined();
  });

  it("refuses ga4 without both the Measurement ID and the API secret", () => {
    process.env.TRACKING_PROVIDER = "ga4";
    process.env.GA_MEASUREMENT_ID = "G-ABC123XYZ";
    resetEnvCache();
    expect(() => getEnv()).toThrow(/GA_MEASUREMENT_ID and GA_API_SECRET/);
  });

  it("rejects something that is not a GA4 Measurement ID", () => {
    process.env.GA_MEASUREMENT_ID = "UA-12345-1";
    resetEnvCache();
    expect(() => getEnv()).toThrow(/GA_MEASUREMENT_ID/);
  });

  it("accepts a complete ga4 configuration", () => {
    process.env.TRACKING_PROVIDER = "ga4";
    process.env.GA_MEASUREMENT_ID = "G-ABC123XYZ";
    process.env.GA_API_SECRET = "secret-value";
    resetEnvCache();
    expect(getEnv().TRACKING_PROVIDER).toBe("ga4");
  });
});
