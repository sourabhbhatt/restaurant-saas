import {
  cacheCurrentPage,
  isCacheableStaffPage,
  purgeCachedStaffPages,
} from "./cache-current-page";

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

  it("at sign-out, removes cached staff pages and leaves public pages", async () => {
    const stored: Record<string, string[]> = {
      others: ["/app/b/b1/orders", "/pricing", "/kitchen/b1?view=all", "/t/abc123"],
      "pages-rsc": ["/app/w/w1/members", "/"],
    };
    const deleted: string[] = [];
    const caches = {
      has: vi.fn(async (name: string) => name in stored),
      open: vi.fn(async (name: string) => ({
        keys: async () => stored[name]!.map((p) => new Request(`http://localhost:3111${p}`)),
        delete: async (req: Request) => {
          const url = new URL(req.url);
          deleted.push(`${name}:${url.pathname}${url.search}`);
          return true;
        },
      })),
    } as unknown as CacheStorage;
    await expect(purgeCachedStaffPages({ caches })).resolves.toBe(3);
    expect(deleted.sort()).toEqual([
      "others:/app/b/b1/orders",
      "others:/kitchen/b1?view=all",
      "pages-rsc:/app/w/w1/members",
    ]);
    // Without Cache Storage (or the caches) nothing happens.
    await expect(purgeCachedStaffPages({ caches: undefined })).resolves.toBeGreaterThanOrEqual(0);
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
