import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { absoluteUrl, getSiteConfig, isNonProductionHost, resolveSiteConfig } from "./site-config";

const STAGING = "https://ros-console-staging-367556472616.asia-south1.run.app";

describe("resolveSiteConfig", () => {
  it("defaults to a non-indexable localhost site", () => {
    const config = resolveSiteConfig({});
    expect(config).toMatchObject({ origin: "http://localhost:3000", indexable: false });
  });

  it("falls back to CONSOLE_URL for canonical URLs when PUBLIC_SITE_URL is unset", () => {
    const config = resolveSiteConfig({ CONSOLE_URL: "http://localhost:3130/" });
    expect(config.origin).toBe("http://localhost:3130");
    expect(config.indexable).toBe(false);
  });

  it("is indexable only with SITE_INDEXABLE=true and an https production origin", () => {
    const config = resolveSiteConfig({
      SITE_INDEXABLE: "true",
      PUBLIC_SITE_URL: "https://www.restaurantos.in/some/path?x=1",
    });
    expect(config).toMatchObject({
      origin: "https://www.restaurantos.in",
      host: "www.restaurantos.in",
      indexable: true,
    });
  });

  it.each([
    ["flag missing", { PUBLIC_SITE_URL: "https://www.restaurantos.in" }],
    [
      "flag not exactly 'true'",
      { SITE_INDEXABLE: "1", PUBLIC_SITE_URL: "https://www.restaurantos.in" },
    ],
    [
      "flag in capitals",
      { SITE_INDEXABLE: "TRUE", PUBLIC_SITE_URL: "https://www.restaurantos.in" },
    ],
    ["no site URL", { SITE_INDEXABLE: "true", CONSOLE_URL: "https://www.restaurantos.in" }],
    ["invalid site URL", { SITE_INDEXABLE: "true", PUBLIC_SITE_URL: "not a url" }],
    ["plain http", { SITE_INDEXABLE: "true", PUBLIC_SITE_URL: "http://www.restaurantos.in" }],
    ["staging on Cloud Run", { SITE_INDEXABLE: "true", PUBLIC_SITE_URL: STAGING }],
    ["localhost", { SITE_INDEXABLE: "true", PUBLIC_SITE_URL: "https://localhost:3000" }],
    ["IP address", { SITE_INDEXABLE: "true", PUBLIC_SITE_URL: "https://10.0.0.5" }],
    ["Firebase default host", { SITE_INDEXABLE: "true", PUBLIC_SITE_URL: "https://ros.web.app" }],
    [
      "a staging subdomain",
      { SITE_INDEXABLE: "true", PUBLIC_SITE_URL: "https://staging.restaurantos.in" },
    ],
    [
      "a preview host on Vercel",
      { SITE_INDEXABLE: "true", PUBLIC_SITE_URL: "https://ros-git-main.vercel.app" },
    ],
  ])("is never indexable with %s", (_label, env) => {
    expect(resolveSiteConfig(env).indexable).toBe(false);
  });

  it("indexes a .co.in production domain and refuses its staging subdomain", () => {
    const prod = { SITE_INDEXABLE: "true", PUBLIC_SITE_URL: "https://www.restaurantos.co.in" };
    const staging = {
      SITE_INDEXABLE: "true",
      PUBLIC_SITE_URL: "https://staging.restaurantos.co.in",
    };
    expect(resolveSiteConfig(prod).indexable).toBe(true);
    expect(resolveSiteConfig(staging)).toMatchObject({
      indexable: false,
      reason: expect.stringContaining("staging.restaurantos.co.in"),
    });
  });

  it("explains why a site is not indexable", () => {
    expect(resolveSiteConfig({ SITE_INDEXABLE: "true", PUBLIC_SITE_URL: STAGING }).reason).toMatch(
      /platform-default host/,
    );
  });
});

describe("isNonProductionHost", () => {
  it.each([
    "localhost",
    "localhost:3130",
    "127.0.0.1",
    "[::1]:3000",
    "app.localhost",
    "ros-console-x.a.run.app",
    "printer.local",
    "svc.internal",
    // Environment subdomains of a real domain
    "staging.restaurantos.in",
    "stage.restaurantos.in",
    "STAGING.restaurantos.in",
    "staging2.restaurantos.in",
    "dev.restaurantos.in",
    "preview.restaurantos.in",
    "test.restaurantos.in",
    "qa.restaurantos.in",
    "uat.restaurantos.in",
    "sandbox.restaurantos.in",
    "www.staging.restaurantos.in",
    "console-staging.restaurantos.in",
    "staging-console.restaurantos.in",
    // Platform-default and tunnel hosts
    "ros.appspot.com",
    "ros-git-main.vercel.app",
    "ros.netlify.app",
    "ros.pages.dev",
    "abc123.ngrok.io",
    "abc123.ngrok-free.app",
    "abc123.ngrok.app",
    "quiet-river.trycloudflare.com",
    "sourabh.github.io",
    "ros.herokuapp.com",
    "ros.azurewebsites.net",
    "ros.onrender.com",
    "ros.fly.dev",
    "ros.up.railway.app",
    "ros.workers.dev",
    "main.d1abc.amplifyapp.com",
    "d111111abcdef8.cloudfront.net",
  ])("flags %s", (host) => expect(isNonProductionHost(host)).toBe(true));

  it.each([
    "restaurantos.in",
    "www.restaurantos.in",
    "app.restaurantos.co.in",
    // The words only count as subdomain labels, not inside the registrable name.
    "devrestaurant.in",
    "teststudio.in",
    "staging.in",
    "contest.restaurantos.in",
    "www.restaurantos.test",
    // Two-level public suffixes: the brand label is part of the registrable name.
    "restaurantos.co.in",
    "www.restaurantos.co.in",
    "www.test-kitchen.co.in",
    "qa-foods.co.in",
    "www.dev-cafe.org.in",
    "stage-door.co.uk",
    "www.preview-bistro.com.au",
  ])("accepts %s", (host) => expect(isNonProductionHost(host)).toBe(false));

  it.each([
    "staging.restaurantos.co.in",
    "www.staging.restaurantos.co.in",
    "dev.restaurantos.org.in",
    "qa.brand.net.in",
    "uat.brand.firm.in",
    "preview.brand.co.uk",
    "staging.brand.com.au",
  ])("flags the environment subdomain %s under a two-level suffix", (host) =>
    expect(isNonProductionHost(host)).toBe(true),
  );
});

describe("getSiteConfig: warning when indexing was asked for but refused", () => {
  const WARNED = Symbol.for("ros.site-config.not-indexable-warned");
  let stderr: MockInstance<typeof console.error>;

  beforeEach(() => {
    delete (globalThis as Record<symbol, unknown>)[WARNED];
    stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stderr.mockRestore();
    vi.unstubAllEnvs();
  });

  it("logs one JSON warning with the reason, however many requests follow", () => {
    vi.stubEnv("SITE_INDEXABLE", "true");
    vi.stubEnv("PUBLIC_SITE_URL", "https://staging.restaurantos.co.in");
    for (let i = 0; i < 3; i++) expect(getSiteConfig().indexable).toBe(false);
    expect(stderr).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(stderr.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(line).toMatchObject({
      level: "warn",
      msg: "site_not_indexable",
      publicSiteUrl: "https://staging.restaurantos.co.in",
      reason: expect.stringContaining("staging"),
    });
  });

  it("stays quiet when the flag is unset or the site is indexable", () => {
    vi.stubEnv("SITE_INDEXABLE", "");
    vi.stubEnv("PUBLIC_SITE_URL", "https://staging.restaurantos.co.in");
    getSiteConfig();
    vi.stubEnv("SITE_INDEXABLE", "true");
    vi.stubEnv("PUBLIC_SITE_URL", "https://www.restaurantos.co.in");
    expect(getSiteConfig().indexable).toBe(true);
    expect(stderr).not.toHaveBeenCalled();
  });
});

describe("absoluteUrl", () => {
  it("joins the origin and a path", () => {
    expect(absoluteUrl({ origin: "https://x.in" }, "/")).toBe("https://x.in/");
    expect(absoluteUrl({ origin: "https://x.in" }, "pricing")).toBe("https://x.in/pricing");
  });
});
