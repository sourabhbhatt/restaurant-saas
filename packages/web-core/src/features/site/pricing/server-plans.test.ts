import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPublicPlans, requestPublicPlans } from "./server-plans";

// `cacheLife` only works inside a Next.js render; the caching itself is Next's job.
vi.mock("next/cache", () => ({ cacheLife: vi.fn() }));

const starter = {
  key: "starter",
  name: "Starter",
  description: "One restaurant",
  currency: "INR",
  monthlyPrice: 49900,
  annualPrice: 499000,
  isTrialEligible: true,
  limits: { maxRestaurants: 1, maxBranches: 1, storageMb: 2048, maxStaff: null },
  features: [{ key: "qr_ordering", label: "QR table ordering" }],
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** A fetch that only settles when its signal aborts, like an API that hangs. */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("requestPublicPlans", () => {
  it("parses the plans from GET /api/v1/public/plans on the internal API", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json({ data: [starter] }));
    const result = await requestPublicPlans("http://api:4000/", { fetch: fetchMock });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api:4000/api/v1/public/plans",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result.data.plans.map((p) => p.key)).toEqual(["starter"]);
    expect(result.fetchedAt).toBeTypeOf("number");
  });

  it.each([
    ["an error response", async () => json({ error: { code: "INTERNAL" } }, 503)],
    ["a body that is not JSON", async () => new Response("<html>bad gateway</html>")],
    ["a body with an unexpected shape", async () => json({ data: { nope: true } })],
    ["a network failure", async () => Promise.reject(new TypeError("fetch failed"))],
  ])("rejects on %s", async (_label, impl) => {
    await expect(requestPublicPlans("http://api:4000", { fetch: vi.fn(impl) })).rejects.toThrow();
  });

  it("gives up when the API does not answer in time", async () => {
    await expect(
      requestPublicPlans("http://api:4000", { fetch: hangingFetch, timeoutMs: 20 }),
    ).rejects.toThrow();
  });
});

describe("loadPublicPlans (what the pages call)", () => {
  it("returns the plans from API_INTERNAL_URL", async () => {
    vi.stubEnv("API_INTERNAL_URL", "http://localhost:4130");
    const fetchMock = vi.fn<typeof fetch>(async () => json({ data: [starter] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await loadPublicPlans();
    expect(result?.data.plans).toHaveLength(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://localhost:4130/api/v1/public/plans");
  });

  it.each([
    ["an error response", async () => json({}, 500)],
    ["a bad body", async () => json({ data: "nope" })],
    ["a timeout", async () => Promise.reject(new DOMException("timed out", "TimeoutError"))],
  ])(
    "returns null on %s, so the page falls back to loading plans in the browser",
    async (_label, impl) => {
      vi.stubGlobal("fetch", vi.fn(impl));
      await expect(loadPublicPlans()).resolves.toBeNull();
    },
  );
});
