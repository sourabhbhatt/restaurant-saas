"use client";

import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { SerwistProvider } from "@serwist/turbopack/react";

import { GlobalToaster, type ToastPosition } from "./global-toaster";
import { createQueryClient } from "./query-client";

/**
 * Client-side providers shared by every route. `pwa` (console and ops) provides
 * the Serwist instance without registering it: `StaffOffline` (./staff-offline),
 * mounted by the staff layouts only, registers the worker and starts the
 * offline runtime. Admin passes `pwa={false}`.
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
      // StaffOffline registers it on staff routes; public and guest pages never do.
      register={false}
      cacheOnNavigation
      // The sync engine handles reconnection; a forced reload would discard in-progress work.
      reloadOnOnline={false}
    >
      <QueryClientProvider client={queryClient}>
        <GlobalToaster defaultPosition={toastPosition} />
        {children}
      </QueryClientProvider>
    </SerwistProvider>
  );
}
