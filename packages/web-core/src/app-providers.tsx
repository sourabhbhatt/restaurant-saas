"use client";

import { useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { QueryClientProvider } from "@tanstack/react-query";
import { SerwistProvider } from "@serwist/turbopack/react";

import { GlobalToaster, type ToastPosition } from "./global-toaster";
import { createQueryClient } from "./query-client";

/**
 * The offline layer (Dexie, sync engine, query persistence: ~40 KB gzip) is a
 * separate chunk, fetched while the page hydrates instead of blocking first
 * paint. It is client-only anyway (it starts in an effect), and the service
 * worker precaches every /_next/static chunk, so it still loads offline.
 */
const OfflineRuntime = dynamic(
  () => import("./features/offline/components/offline-runtime").then((m) => m.OfflineRuntime),
  { ssr: false },
);

/**
 * Client-side providers shared by every route. `pwa` registers the Serwist
 * service worker and the offline runtime (console and ops); admin passes false.
 * It also renders the app's only toast container (`toastPosition` is the
 * default placement; guest, sign-in, staff and kitchen routes have their own).
 */
export function AppProviders({
  children,
  pwa = true,
  toastPosition = "top-right",
}: {
  children: ReactNode;
  pwa?: boolean;
  toastPosition?: ToastPosition;
}) {
  // One QueryClient per browser session (never shared between requests on the server).
  const [queryClient] = useState(createQueryClient);

  if (!pwa) {
    return (
      <QueryClientProvider client={queryClient}>
        <GlobalToaster defaultPosition={toastPosition} />
        {children}
      </QueryClientProvider>
    );
  }

  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      // Avoid stale cached assets while developing; the worker is tested against `next start`.
      disable={process.env.NODE_ENV === "development"}
      cacheOnNavigation
      // The sync engine handles reconnection; a forced reload would discard in-progress work.
      reloadOnOnline={false}
    >
      <QueryClientProvider client={queryClient}>
        {/* Offline layer: sync engine, connectivity probe, query persistence (client only). */}
        <OfflineRuntime />
        <GlobalToaster defaultPosition={toastPosition} />
        {children}
      </QueryClientProvider>
    </SerwistProvider>
  );
}
