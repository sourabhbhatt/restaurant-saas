"use client";

import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { SerwistProvider } from "@serwist/turbopack/react";

import { createQueryClient } from "@/lib/query-client";

/** Client-side providers shared by every route. */
export function AppProviders({ children }: { children: ReactNode }) {
  // One QueryClient per browser session (never shared between requests on the server).
  const [queryClient] = useState(createQueryClient);

  return (
    <SerwistProvider
      swUrl="/serwist/sw.js"
      // Avoid stale cached assets while developing; the worker is tested against `next start`.
      disable={process.env.NODE_ENV === "development"}
      cacheOnNavigation
      // The sync engine handles reconnection; a forced reload would discard in-progress work.
      reloadOnOnline={false}
    >
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </SerwistProvider>
  );
}
