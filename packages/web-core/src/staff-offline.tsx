"use client";

import { useEffect } from "react";
import { useSerwist } from "@serwist/turbopack/react";

import { OfflineRuntime } from "./features/offline/components/offline-runtime";

/** One registration per tab; a staff layout that mounts later does not register again. */
let registration: Promise<unknown> | null = null;

/**
 * The offline layer, for staff routes only: console `/app/**` and `/print/**`
 * (their layouts) and every ops route (its root layout). It registers the
 * service worker, which precaches the app's chunks, and starts the sync
 * engine and query persistence. Public, sign-in and guest QR pages never
 * mount it, so their visitors download neither the worker's precache (about
 * 1 MB) nor the offline runtime.
 *
 * It is a static import of those layouts, not a lazy chunk: the runtime then
 * subscribes before the page's first queries resolve (so they are persisted)
 * and no Suspense boundary sits in front of the page.
 */
export function StaffOffline() {
  const { serwist } = useSerwist();
  useEffect(() => {
    if (!serwist || registration) return;
    registration = serwist.register().catch(() => {
      // Blocked or unsupported here: let the next staff layout try again.
      registration = null;
    });
  }, [serwist]);
  return <OfflineRuntime />;
}
