"use client";

import { CloudOffIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@ros/ui/ui/button";
import { PendingChangesSummary } from "./pending-changes-summary";
import { RetryButton } from "./retry-button";

/** Body of each app's `/~offline` page; `home` is the app's own start page. */
export function OfflinePageContent({ home }: { home: { href: string; label: string } }) {
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
          menu and settings edits, kitchen ticket updates and staff orders (saved here, synced
          later).
        </li>
        <li>
          <strong className="text-foreground">Needs a connection:</strong> guest orders, accepting
          or rejecting orders, bills, payments and refunds.
        </li>
      </ul>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <RetryButton />
        <Button variant="outline" asChild>
          <Link href={home.href}>{home.label}</Link>
        </Button>
      </div>
    </main>
  );
}
