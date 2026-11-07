"use client";

import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { SerwistProvider } from "@serwist/turbopack/react";

import { OfflineRuntime } from "./features/offline/components/offline-runtime";
import { createQueryClient } from "./query-client";

/**
 * Client-side providers shared by every route. `pwa` registers the Serwist
 * service worker and the offline runtime (console and ops); admin passes false.
 */
export function AppProviders({ children, pwa = true }: { children: ReactNode; pwa?: boolean }) {
  // One QueryClient per browser session (never shared between requests on the server).
  const [queryClient] = useState(createQueryClient);

  if (!pwa) return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

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
        {children}
      </QueryClientProvider>
    </SerwistProvider>
  );
}
