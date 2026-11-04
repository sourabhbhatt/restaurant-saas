import type { Metadata } from "next";

import { RetryButton } from "./retry-button";

export const metadata: Metadata = {
  title: "Offline",
};

/**
 * Served by the service worker when a page that isn't cached is requested
 * without a connection. It is precached at build time.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">You&apos;re offline</h1>
      <p className="text-muted-foreground">
        This page hasn&apos;t been saved on this device yet. Reconnect to the internet and try
        again.
      </p>
      <RetryButton />
    </main>
  );
}
