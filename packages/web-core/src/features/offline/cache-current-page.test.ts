import { cacheCurrentPage } from "./cache-current-page";

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
});
