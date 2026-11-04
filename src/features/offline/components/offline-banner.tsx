"use client";

import { CloudOffIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { useSyncStore, waitingCount } from "../sync-store";

/**
 * Thin top bar shown while the device has no (real) connection. Explains
 * what keeps working and what needs a connection.
 */
export function OfflineBanner({ className }: { className?: string }) {
  const online = useSyncStore((s) => s.online);
  const waiting = useSyncStore((s) => waitingCount(s.counts));
  if (online) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      data-slot="offline-banner"
      className={cn(
        "flex w-full items-start justify-center gap-2 border-b border-warning/40 bg-warning/15 px-4 py-1.5 text-center text-xs text-warning-foreground sm:items-center dark:text-warning",
        className,
      )}
    >
      <CloudOffIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 sm:mt-0" />
      <p className="text-balance">
        <strong className="font-semibold">You&apos;re offline.</strong> Saved screens stay visible
        and menu or settings edits are kept on this device
        {waiting > 0 ? ` (${waiting} waiting)` : ""}. New orders, accepting orders and payments need
        a connection.
      </p>
    </div>
  );
}
