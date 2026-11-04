"use client";

import { HistoryIcon } from "lucide-react";

import { cn } from "@/lib/utils";

import { absoluteTime, relativeTime } from "../format-time";
import { useSyncStore } from "../sync-store";

export interface OfflineDataNoticeProps {
  /** `dataUpdatedAt` of the query being shown (epoch ms). */
  updatedAt: number | undefined;
  /** The latest refetch failed while older data is shown (e.g. `query.isRefetchError`). */
  refetchFailed?: boolean;
  className?: string;
}

/**
 * "Offline — showing saved data from <time>" hint for views rendering
 * cached data. Renders nothing while online with fresh data.
 */
export function OfflineDataNotice({ updatedAt, refetchFailed, className }: OfflineDataNoticeProps) {
  const online = useSyncStore((s) => s.online);
  if (!updatedAt || (online && !refetchFailed)) return null;
  return (
    <p
      role="status"
      data-slot="offline-data-notice"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground",
        className,
      )}
    >
      <HistoryIcon aria-hidden="true" className="size-3.5" />
      <span>
        {online ? "Couldn't refresh" : "Offline"} — showing saved data from{" "}
        <time dateTime={new Date(updatedAt).toISOString()} title={absoluteTime(updatedAt)}>
          {relativeTime(updatedAt)}
        </time>
      </span>
    </p>
  );
}
