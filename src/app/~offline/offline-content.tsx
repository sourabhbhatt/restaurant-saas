"use client";

import { CloudOffIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { PendingChangesSummary } from "@/features/offline/components/pending-changes-summary";

import { RetryButton } from "./retry-button";

export function OfflinePageContent() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <div
        aria-hidden="true"
        className="flex size-14 items-center justify-center rounded-full bg-warning/15 text-warning-foreground dark:text-warning"
      >
        <CloudOffIcon className="size-7" />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">You&apos;re offline</h1>
        <p className="text-muted-foreground">
          This page hasn&apos;t been saved on this device yet. Reconnect to the internet and try
          again.
        </p>
      </div>
      <PendingChangesSummary />
      <ul className="flex w-full flex-col gap-1.5 rounded-lg border bg-card p-4 text-left text-sm text-muted-foreground">
        <li>
          <strong className="text-foreground">Works offline:</strong> screens you opened before,
          menu availability and menu or settings edits (saved here, synced later).
        </li>
        <li>
          <strong className="text-foreground">Needs a connection:</strong> placing and accepting
          orders, and recording payments.
        </li>
      </ul>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <RetryButton />
        <Button variant="outline" asChild>
          <Link href="/app">Go to dashboard</Link>
        </Button>
      </div>
    </main>
  );
}
