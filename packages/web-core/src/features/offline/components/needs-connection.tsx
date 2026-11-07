"use client";

import { WifiOff } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@ros/ui/utils";

import { useSyncStore } from "../sync-store";

/** True while the device has no confirmed connection to the server. */
export function useIsOffline(): boolean {
  return useSyncStore((s) => !s.online);
}

/**
 * Reason shown next to a server-authoritative control (accept, bills,
 * payments…) that is disabled offline. Renders nothing while online.
 */
export function NeedsConnectionNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const offline = useIsOffline();
  if (!offline) return null;
  return (
    <p
      data-slot="needs-connection"
      className={cn("flex w-full items-center gap-1.5 text-xs text-muted-foreground", className)}
    >
      <WifiOff className="size-3.5 shrink-0" aria-hidden />
      {children}
    </p>
  );
}
