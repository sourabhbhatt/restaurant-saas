import type { Metadata } from "next";

import { OfflinePageContent } from "./offline-content";

export const metadata: Metadata = {
  title: "Offline",
};

/**
 * Served by the service worker when a page that isn't cached is requested
 * without a connection. It is precached at build time.
 */
export default function OfflinePage() {
  return <OfflinePageContent />;
}
