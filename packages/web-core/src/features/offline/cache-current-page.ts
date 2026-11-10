/**
 * The page a tab loads first is fetched before the service worker controls
 * it, so its HTML never reaches the worker's cache: reloading that screen
 * offline showed the offline page instead of the staff screen and its saved
 * data. Ask the worker to cache the current URL (Serwist's `CACHE_URLS`
 * message, the one `cacheOnNavigation` sends after client-side navigations)
 * when no cache holds it yet.
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
  const registration = await sw.ready;
  const url = `${loc.pathname}${loc.search}`;
  if (!online() || (await cacheStorage.match(url))) return false;
  registration.active?.postMessage({ type: "CACHE_URLS", payload: { urlsToCache: [url] } });
  return Boolean(registration.active);
}
