import { cacheCurrentPage, isCacheableStaffPage } from "./cache-current-page";

function setup(options: { cached?: boolean; online?: boolean; active?: boolean } = {}) {
  const postMessage = vi.fn();
  const serviceWorker = {
    ready: Promise.resolve({ active: options.active === false ? null : { postMessage } }),
  } as unknown as ServiceWorkerContainer;
  const caches = {
    match: vi.fn(async () => (options.cached ? new Response("cached") : undefined)),
  } as unknown as CacheStorage;
  const env = {
    serviceWorker,
    caches,
    location: { pathname: "/kitchen/b1", search: "?view=all" },
    online: () => options.online ?? true,
  };
  return { env, postMessage, caches };
}

describe("cacheCurrentPage", () => {
  it("asks the worker to cache the page the tab opened on", async () => {
    const { env, postMessage } = setup();
    await expect(cacheCurrentPage(env)).resolves.toBe(true);
    expect(postMessage).toHaveBeenCalledWith({
      type: "CACHE_URLS",
      payload: { urlsToCache: ["/kitchen/b1?view=all"] },
    });
  });

  it("does nothing when the page is already cached, offline, or without an active worker", async () => {
    for (const options of [{ cached: true }, { online: false }, { active: false }]) {
      const { env, postMessage } = setup(options);
      await expect(cacheCurrentPage(env)).resolves.toBe(false);
      expect(postMessage).not.toHaveBeenCalled();
    }
  });

  it("caches only staff screens, never public, auth or guest pages or token URLs", async () => {
    const cases: [string, string, boolean][] = [
      ["/app/b/b1/orders", "", true],
      ["/app", "", true],
      ["/waiter/b1", "", true],
      ["/cashier/b1", "?tab=bills", true],
      ["/", "", false],
      ["/pricing", "", false],
      ["/sign-in", "?next=%2Fapp", false],
      ["/reset-password", "?token=abc", false],
      ["/verify-email", "?token=abc", false],
      ["/invite/abc123", "", false],
      ["/t/abc123", "", false],
      ["/application", "", false],
      ["/app/b/b1", "?token=abc", false],
    ];
    for (const [pathname, search, cached] of cases) {
      const { env, postMessage } = setup();
      await expect(cacheCurrentPage({ ...env, location: { pathname, search } })).resolves.toBe(
        cached,
      );
      expect(postMessage).toHaveBeenCalledTimes(cached ? 1 : 0);
      expect(isCacheableStaffPage(pathname, search), `${pathname}${search}`).toBe(cached);
    }
  });
});
