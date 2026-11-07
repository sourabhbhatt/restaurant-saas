// Worker types come from the "webworker" lib in tsconfig.json. Don't add
// `/// <reference no-default-lib="true" />` here: it removes the DOM lib from
// the whole program.
import { defaultCache } from "@serwist/turbopack/worker";
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  type PrecacheEntry,
  type RuntimeCaching,
  type SerwistGlobalConfig,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Injected at build time with the list of files to precache.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

/**
 * Caching policy:
 * - /api/** is NetworkOnly: API responses are never cached by the worker.
 *   Data for offline use lives in IndexedDB (versioned, per user, synced by
 *   the app), so a stale or other user's response can never be served here.
 * - Customer QR pages (/t/*): the page shell and its static assets are
 *   cached so a flaky connection at the table still shows the menu UI;
 *   ordering itself always needs the network.
 * - Everything else: Serwist's defaults for Next.js (hashed assets
 *   cache-first, pages network-first).
 */
const runtimeCaching: RuntimeCaching[] = [
  {
    matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api/"),
    handler: new NetworkOnly(),
  },
  {
    matcher: ({ request, url, sameOrigin }) =>
      sameOrigin && request.mode === "navigate" && url.pathname.startsWith("/t/"),
    handler: new NetworkFirst({
      cacheName: "customer-pages",
      networkTimeoutSeconds: 5,
      plugins: [new ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: 24 * 60 * 60 })],
    }),
  },
  {
    matcher: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/_next/static/"),
    handler: new CacheFirst({
      cacheName: "next-static-assets",
      plugins: [new ExpirationPlugin({ maxEntries: 256, maxAgeSeconds: 30 * 24 * 60 * 60 })],
    }),
  },
  ...defaultCache,
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching,
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher({ request }) {
          return request.destination === "document";
        },
      },
    ],
  },
});

// Browser push (only active when a push provider is configured on the server;
// the default noop provider never sends anything). Payload: { title, body?, url?, tag? }.
self.addEventListener("push", (event) => {
  let payload: { title?: string; body?: string; url?: string; tag?: string } = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { title: event.data?.text() };
  }
  if (!payload.title) return;
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: payload.url ?? "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = (event.notification.data as { url?: string } | null)?.url ?? "/";
  // Only open same-origin paths.
  let target = new URL("/", self.location.origin);
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    const candidate = new URL(raw, self.location.origin);
    if (candidate.origin === self.location.origin) target = candidate;
  }
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of windows) {
        if (new URL(client.url).origin === target.origin && "focus" in client) {
          await client.focus();
          if ("navigate" in client) await client.navigate(target.href);
          return;
        }
      }
      await self.clients.openWindow(target.href);
    })(),
  );
});

serwist.addEventListeners();
