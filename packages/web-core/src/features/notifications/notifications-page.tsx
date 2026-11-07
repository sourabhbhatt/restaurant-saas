"use client";

import Link from "next/link";
import { ArrowLeftIcon, CheckCheckIcon, InboxIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, ErrorState, PageHeader, PageSkeleton } from "@ros/ui/shared/feedback";
import { Button } from "@ros/ui/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ros/ui/ui/select";
import { Spinner } from "@ros/ui/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@ros/ui/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@ros/ui/ui/toggle-group";
import { NOTIFICATION_TYPES, type NotificationType } from "@ros/contracts/notifications";
import { NOTIFICATION_TYPE_LABELS } from "@ros/contracts/notifications-api";
import { OfflineDataNotice } from "../offline/components/offline-data-notice";
import { AuthGate } from "../session/auth-gate";
import { useMe } from "../session/queries";
import { errorMessage } from "@ros/api-client";

import { NotificationItem } from "./notification-item";
import { NotificationPreferences } from "./preferences-form";
import { useMarkNotificationsRead, useNotificationList, type NotificationFilters } from "./queries";

const ALL = "all";

/** /app/notifications: full notification list with filters, plus preferences. */
export function NotificationsPage() {
  return (
    <AuthGate>
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <PageHeader
          breadcrumbs={
            <Link
              href="/app"
              className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
              <ArrowLeftIcon aria-hidden="true" className="size-4" />
              Back to dashboard
            </Link>
          }
          title="Notifications"
          description="Order, billing and account updates for you across your workspaces."
        />
        <Tabs defaultValue="inbox" className="gap-4">
          <TabsList>
            <TabsTrigger value="inbox">Inbox</TabsTrigger>
            <TabsTrigger value="preferences">Preferences</TabsTrigger>
          </TabsList>
          <TabsContent value="inbox">
            <Inbox />
          </TabsContent>
          <TabsContent value="preferences">
            <NotificationPreferences />
          </TabsContent>
        </Tabs>
      </main>
    </AuthGate>
  );
}

function Inbox() {
  const me = useMe();
  const workspaces = me.data?.workspaces ?? [];
  const [show, setShow] = useState<"all" | "unread">("all");
  const [type, setType] = useState<NotificationType | typeof ALL>(ALL);
  const [workspaceId, setWorkspaceId] = useState<string>(ALL);

  const filters: NotificationFilters = {
    unread: show === "unread",
    type: type === ALL ? undefined : type,
    workspaceId: workspaceId === ALL ? undefined : workspaceId,
  };
  const list = useNotificationList(filters);
  const markRead = useMarkNotificationsRead();

  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const unreadCount = list.data?.pages[0]?.unreadCount ?? 0;
  const filtered = show === "unread" || type !== ALL || workspaceId !== ALL;

  const mark = (input: { ids: string[] } | { all: true }) =>
    markRead.mutate(
      "all" in input ? { all: true, workspaceId: filters.workspaceId } : { ids: input.ids },
      {
        onSuccess: (res) => {
          if ("all" in input && res.updated > 0) toast.success("All caught up");
        },
        onError: (error) => toast.error(errorMessage(error)),
      },
    );

  return (
    <div className="flex flex-col gap-4">
      <div
        role="group"
        aria-label="Filters"
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
      >
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={show}
          onValueChange={(v) => {
            if (v === "all" || v === "unread") setShow(v);
          }}
          aria-label="Show"
        >
          <ToggleGroupItem value="all" className="px-3">
            All
          </ToggleGroupItem>
          <ToggleGroupItem value="unread" className="px-3">
            Unread{unreadCount > 0 ? ` (${unreadCount})` : ""}
          </ToggleGroupItem>
        </ToggleGroup>
        <Select value={type} onValueChange={(v) => setType(v as NotificationType | typeof ALL)}>
          <SelectTrigger size="sm" className="sm:w-52" aria-label="Notification type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All types</SelectItem>
            {NOTIFICATION_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {NOTIFICATION_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {workspaces.length > 1 && (
          <Select value={workspaceId} onValueChange={setWorkspaceId}>
            <SelectTrigger size="sm" className="sm:w-52" aria-label="Workspace">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All workspaces</SelectItem>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="sm:ml-auto"
            onClick={() => mark({ all: true })}
            disabled={markRead.isPending}
          >
            <CheckCheckIcon aria-hidden="true" />
            Mark all read
          </Button>
        )}
      </div>

      <OfflineDataNotice updatedAt={list.dataUpdatedAt} refetchFailed={list.isRefetchError} />

      {list.isPending ? (
        <PageSkeleton variant="list" count={5} label="Loading notifications" />
      ) : list.isError && !list.data ? (
        <ErrorState
          title="Couldn't load notifications"
          message={errorMessage(list.error)}
          onRetry={() => void list.refetch()}
          retrying={list.isFetching}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<InboxIcon />}
          title={filtered ? "No notifications match these filters" : "No notifications yet"}
          description={
            filtered
              ? "Try showing all notifications or another type."
              : "You'll be notified here about new orders, bill requests and account updates."
          }
          action={
            filtered ? (
              <Button
                variant="outline"
                onClick={() => {
                  setShow("all");
                  setType(ALL);
                  setWorkspaceId(ALL);
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <ul className="divide-y overflow-hidden rounded-xl border" aria-label="Notifications">
            {items.map((n) => (
              <NotificationItem
                key={n.id}
                notification={n}
                onMarkRead={(id) => mark({ ids: [id] })}
              />
            ))}
          </ul>
          {list.hasNextPage && (
            <Button
              variant="outline"
              className="self-center"
              onClick={() => void list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
            >
              {list.isFetchingNextPage && <Spinner decorative />}
              Load more
            </Button>
          )}
          {list.isFetchNextPageError && (
            <p role="alert" className="text-center text-sm text-destructive">
              Couldn&apos;t load more notifications. {errorMessage(list.error)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
