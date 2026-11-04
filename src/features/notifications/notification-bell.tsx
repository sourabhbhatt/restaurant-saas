"use client";

import Link from "next/link";
import { BellIcon, CheckCheckIcon, InboxIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, ErrorState, LoadingState } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OfflineDataNotice } from "@/features/offline/components/offline-data-notice";
import { errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";

import { NotificationItem } from "./notification-item";
import { PushOptIn } from "./push-opt-in";
import { useMarkNotificationsRead, useNotificationBell } from "./queries";

/**
 * Topbar notification bell: unread badge (polled every 30s and on focus),
 * dropdown with the latest notifications for this workspace (plus
 * platform-wide ones), mark-as-read and a link to the full list.
 */
export function NotificationBell({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const bell = useNotificationBell(workspaceId);
  const markRead = useMarkNotificationsRead();
  const unread = bell.data?.unreadCount ?? 0;
  const items = bell.data?.items ?? [];

  const mark = (input: { ids: string[] } | { all: true }) =>
    markRead.mutate("all" in input ? { all: true, workspaceId } : { ids: input.ids }, {
      onError: (error) => toast.error(errorMessage(error)),
    });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
        >
          <BellIcon aria-hidden="true" />
          {unread > 0 && (
            <span
              aria-hidden="true"
              className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-semibold text-white tabular-nums"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(calc(100vw-1.5rem),24rem)] p-0">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
          <h2 className="text-sm font-semibold">
            Notifications
            {unread > 0 && (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {unread} unread
              </span>
            )}
          </h2>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => mark({ all: true })}
              disabled={markRead.isPending}
            >
              <CheckCheckIcon aria-hidden="true" />
              Mark all read
            </Button>
          )}
        </div>

        <div className="max-h-[min(70vh,26rem)] overflow-y-auto">
          {bell.isPending ? (
            <LoadingState label="Loading notifications…" className="py-8" />
          ) : bell.isError && !bell.data ? (
            <ErrorState
              size="compact"
              title="Couldn't load notifications"
              message={errorMessage(bell.error)}
              onRetry={() => void bell.refetch()}
              retrying={bell.isFetching}
            />
          ) : items.length === 0 ? (
            <EmptyState
              size="compact"
              icon={<InboxIcon />}
              title="You're all caught up"
              description="New orders, bill requests and account updates will appear here."
            />
          ) : (
            <>
              <div className="px-3 pt-2 empty:hidden">
                <OfflineDataNotice
                  updatedAt={bell.dataUpdatedAt}
                  refetchFailed={bell.isRefetchError}
                />
              </div>
              <ul className={cn("divide-y")} aria-label="Latest notifications">
                {items.map((n) => (
                  <NotificationItem
                    key={n.id}
                    notification={n}
                    dense
                    onMarkRead={(id) => mark({ ids: [id] })}
                    onNavigate={() => setOpen(false)}
                  />
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
          <Button variant="link" size="sm" className="h-auto px-0" asChild>
            <Link href="/app/notifications" onClick={() => setOpen(false)}>
              View all notifications
            </Link>
          </Button>
          <PushOptIn />
        </div>
      </PopoverContent>
    </Popover>
  );
}
