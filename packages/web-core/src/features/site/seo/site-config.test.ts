import { describe, expect, it } from "vitest";

import { absoluteUrl, isNonProductionHost, resolveSiteConfig } from "./site-config";

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
  ])("accepts %s", (host) => expect(isNonProductionHost(host)).toBe(false));
});

describe("absoluteUrl", () => {
  it("joins the origin and a path", () => {
    expect(absoluteUrl({ origin: "https://x.in" }, "/")).toBe("https://x.in/");
    expect(absoluteUrl({ origin: "https://x.in" }, "pricing")).toBe("https://x.in/pricing");
  });
});
