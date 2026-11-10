/**
 * Staff screens that must reload offline: the console's signed-in area and
 * the ops consoles. Public pages, auth pages and guest QR pages (`/t/<token>`,
 * served from their own `customer-pages` cache) are left out, and so is any
 * URL carrying a token in its query (reset, verify, invite links).
 */
const STAFF_PAGE = /^\/(app|waiter|kitchen|cashier)(\/|$)/;

export function isCacheableStaffPage(pathname: string, search: string): boolean {
  return STAFF_PAGE.test(pathname) && !/token/i.test(search);
}

/**
 * The page a tab loads first is fetched before the service worker controls
 * it, so its HTML never reaches the worker's cache: reloading that screen
 * offline showed the offline page instead of the staff screen and its saved
 * data. Ask the worker to cache the current URL (Serwist's `CACHE_URLS`
 * message, the one `cacheOnNavigation` sends after client-side navigations)
 * when it is a staff screen and no cache holds it yet. The HTML is a
 * user-agnostic client shell (see docs/offline-sync.md).
 */
export async function cacheCurrentPage(
  env: {
    serviceWorker?: ServiceWorkerContainer;
    caches?: CacheStorage;
    location?: Pick<Location, "pathname" | "search">;
    online?: () => boolean;
  } = {},
): Promise<boolean> {
  const sw =
    env.serviceWorker ?? (typeof navigator !== "undefined" ? navigator.serviceWorker : undefined);
  const cacheStorage = env.caches ?? (typeof caches !== "undefined" ? caches : undefined);
  const loc = env.location ?? (typeof location !== "undefined" ? location : undefined);
  const online = env.online ?? (() => typeof navigator === "undefined" || navigator.onLine);
  if (!sw || !cacheStorage || !loc) return false;
  if (!isCacheableStaffPage(loc.pathname, loc.search)) return false;
  const registration = await sw.ready;
  const url = `${loc.pathname}${loc.search}`;
  if (!online() || (await cacheStorage.match(url))) return false;
  registration.active?.postMessage({ type: "CACHE_URLS", payload: { urlsToCache: [url] } });
  return Boolean(registration.active);
}

/**
 * Worker caches that can hold staff pages: `others` (first pages sent with
 * CACHE_URLS, see above) and Serwist's page caches for Next.js navigations.
 */
const PAGE_CACHES = ["others", "pages", "pages-rsc", "pages-rsc-prefetch"] as const;

/**
 * Sign-out: remove cached staff pages so their URLs (branch and workspace
 * ids) do not stay on a shared device. The HTML holds no user data, but the
 * next account has no use for the previous one's screens either. Public pages
 * stay cached. Returns how many entries were removed.
 */
export async function purgeCachedStaffPages(env: { caches?: CacheStorage } = {}): Promise<number> {
  const cacheStorage =
    "caches" in env ? env.caches : typeof caches !== "undefined" ? caches : undefined;
  if (!cacheStorage) return 0;
  let removed = 0;
  for (const name of PAGE_CACHES) {
    if (!(await cacheStorage.has(name))) continue;
    const cache = await cacheStorage.open(name);
    for (const request of await cache.keys()) {
      const url = new URL(request.url);
      if (isCacheableStaffPage(url.pathname, url.search) && (await cache.delete(request))) {
        removed += 1;
      }
    }
  }
  return removed;
}
