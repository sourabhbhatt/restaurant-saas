"use client";

import { ArrowLeft, ChefHat, Maximize, Minimize, Moon, Sun } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { EmptyState, ErrorState, PageSkeleton } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { KitchenOrderDto } from "@/contracts/staff-ops";
import type { BranchContextDto } from "@/contracts/structure";
import type { OrderPriority } from "@/domain/orders/order-status";
import { errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { OrderItemsList, OrderStatusBadge } from "@/features/orders/order-ui";
import { formatClock, useNow } from "@/features/orders/use-now";
import { useAlertSound, useNewIds } from "@/features/realtime/alert-sound";
import { ConnectionStatus } from "@/features/realtime/connection-status";
import { SoundControl } from "@/features/realtime/sound-control";
import { useBranchEvents } from "@/features/realtime/use-branch-events";
import { OfflineBanner, SyncStatusIndicator } from "@/features/offline";
import { ProfileMenu } from "@/features/navigation/profile-menu";
import { AuthGate } from "@/features/session/auth-gate";
import { permissionChecker, useBranchContext } from "@/features/session/queries";

import { useKitchenFeed } from "./queries";
import { TicketCard, ticketIsDelayed } from "./ticket-card";

type View = "active" | "completed";
type Sort = "time" | "priority";
type Theme = "dark" | "light";

const PRIORITY_RANK: Record<OrderPriority, number> = { RUSH: 0, HIGH: 1, NORMAL: 2 };
const t = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

/** Per-device preference persisted in localStorage. */
function useStoredChoice<T extends string>(key: string, initial: T, allowed: readonly T[]) {
  // Rendered only on the client (behind AuthGate), so reading storage here is safe.
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = window.localStorage.getItem(key) as T | null;
      return stored && allowed.includes(stored) ? stored : initial;
    } catch {
      return initial;
    }
  });
  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // ignore
      }
    },
    [key],
  );
  return [value, update] as const;
}

function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [supported] = useState(
    () => typeof document !== "undefined" && Boolean(document.documentElement.requestFullscreen),
  );
  useEffect(() => {
    const update = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);
  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      toast.error("Full screen is not available on this device");
    }
  }, []);
  return { isFullscreen, supported, toggle };
}

function Clock() {
  const now = useNow(15_000);
  return (
    <span className="hidden text-lg font-semibold tabular-nums sm:block" aria-label="Current time">
      {new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
    </span>
  );
}

function CompletedTicket({ order }: { order: KitchenOrderDto }) {
  return (
    <article className="flex flex-col gap-2 rounded-2xl border bg-card p-4 text-card-foreground opacity-90">
      <header className="flex items-start justify-between gap-2">
        <div>
          <p className="text-2xl font-bold tabular-nums">#{order.orderNumber}</p>
          <p className="text-lg font-semibold">{order.tableName}</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-sm text-muted-foreground">
          <OrderStatusBadge status={order.status} />
          <span>
            {order.status === "CANCELLED" ? "Cancelled" : "Served"}{" "}
            {formatClock(order.servedAt ?? order.completedAt)}
          </span>
        </div>
      </header>
      <OrderItemsList items={order.items} />
      {order.cancellationReason && (
        <p className="text-sm text-destructive">Reason: {order.cancellationReason}</p>
      )}
    </article>
  );
}

function KitchenScreen({ branchId, ctx }: { branchId: string; ctx: BranchContextDto }) {
  const can = permissionChecker(ctx.permissions);
  const realtime = useBranchEvents(branchId);
  const feed = useKitchenFeed(branchId, realtime.pollInterval);
  const now = useNow(5_000);
  const [view, setView] = useState<View>("active");
  const [sort, setSort] = useStoredChoice<Sort>(`ros:kds-sort:${branchId}`, "time", [
    "time",
    "priority",
  ]);
  const [theme, setTheme] = useStoredChoice<Theme>("ros:kds-theme", "dark", ["dark", "light"]);
  const fullscreen = useFullscreen();
  const sound = useAlertSound(
    `ros:kitchen-sound:${branchId}`,
    feed.data?.kitchenSoundEnabled ?? true,
  );
  const [fresh, setFresh] = useState<Set<string>>(new Set());

  const data = feed.data;
  const delay = data?.kitchenDelayMinutes ?? 20;

  const active = useMemo(() => {
    const list = [...(data?.active ?? [])];
    list.sort((a, b) =>
      sort === "priority"
        ? PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || t(a.acceptedAt) - t(b.acceptedAt)
        : t(a.acceptedAt) - t(b.acceptedAt),
    );
    // Ready tickets move to the end: they are waiting for the waiter.
    return [
      ...list.filter((o) => o.status !== "READY"),
      ...list.filter((o) => o.status === "READY"),
    ];
  }, [data?.active, sort]);

  const onNewTickets = (ids: string[]) => {
    sound.play("new");
    for (const o of (data?.active ?? []).filter((x) => ids.includes(x.id))) {
      toast.info(`New ticket #${o.orderNumber} · ${o.tableName}`);
    }
    setFresh((s) => new Set([...s, ...ids]));
    setTimeout(() => setFresh((s) => new Set([...s].filter((x) => !ids.includes(x)))), 20_000);
  };
  useNewIds(
    data ? data.active.filter((o) => o.status === "ACCEPTED").map((o) => o.id) : undefined,
    onNewTickets,
  );

  const delayedCount = active.filter((o) => ticketIsDelayed(o, delay, now)).length;
  const counts = {
    queued: active.filter((o) => o.status === "ACCEPTED").length,
    cooking: active.filter((o) => o.status === "PREPARING").length,
    ready: active.filter((o) => o.status === "READY").length,
  };

  return (
    <div
      className={cn(
        theme === "dark" && "dark",
        "flex min-h-dvh flex-col bg-background text-foreground",
      )}
    >
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href={`/app/b/${branchId}`} aria-label="Back to branch dashboard">
              <ArrowLeft aria-hidden />
            </Link>
          </Button>
          <div className="min-w-0">
            <p className="truncate text-lg leading-tight font-bold">{ctx.branchName} · Kitchen</p>
            <p className="truncate text-sm text-muted-foreground">
              {counts.queued} new · {counts.cooking} cooking · {counts.ready} ready
              {delayedCount > 0 && (
                <span className="font-semibold text-destructive"> · {delayedCount} delayed</span>
              )}
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <SyncStatusIndicator />
            <ProfileMenu
              workspaceId={ctx.workspaceId}
              workspaceName={ctx.workspaceName}
              roleLabel={ctx.roleLabel}
              branchLabel={`${ctx.restaurantName} · ${ctx.branchName}`}
            />
            <Clock />
            <ConnectionStatus status={realtime.status} lastSyncedAt={feed.dataUpdatedAt} />
            <ToggleGroup
              type="single"
              variant="outline"
              value={view}
              onValueChange={(v) => v && setView(v as View)}
              aria-label="Show tickets"
            >
              <ToggleGroupItem value="active" className="px-3">
                Active
              </ToggleGroupItem>
              <ToggleGroupItem value="completed" className="px-3">
                Completed
              </ToggleGroupItem>
            </ToggleGroup>
            {view === "active" && (
              <ToggleGroup
                type="single"
                variant="outline"
                value={sort}
                onValueChange={(v) => v && setSort(v as Sort)}
                aria-label="Sort tickets"
              >
                <ToggleGroupItem value="time" className="px-3">
                  Oldest
                </ToggleGroupItem>
                <ToggleGroupItem value="priority" className="px-3">
                  Priority
                </ToggleGroupItem>
              </ToggleGroup>
            )}
            <SoundControl sound={sound} />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={theme === "dark" ? "Use light theme" : "Use dark high-contrast theme"}
              title={theme === "dark" ? "Light theme" : "Dark theme"}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun aria-hidden /> : <Moon aria-hidden />}
            </Button>
            {fullscreen.supported && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={fullscreen.isFullscreen ? "Exit full screen" : "Full screen"}
                title={fullscreen.isFullscreen ? "Exit full screen" : "Full screen"}
                onClick={() => void fullscreen.toggle()}
              >
                {fullscreen.isFullscreen ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
              </Button>
            )}
          </div>
        </div>
      </header>
      <OfflineBanner />

      <main className="flex-1 p-4">
        {feed.isPending ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-72 rounded-2xl" />
            ))}
          </div>
        ) : feed.isError && !data ? (
          <ErrorState
            title="Kitchen feed unavailable"
            message={errorMessage(feed.error)}
            onRetry={() => void feed.refetch()}
            retrying={feed.isFetching}
          />
        ) : view === "active" ? (
          active.length === 0 ? (
            <EmptyState
              icon={<ChefHat />}
              title="No tickets right now"
              description="Accepted orders appear here instantly. Pending orders wait for a waiter first."
              className="min-h-[50dvh]"
            />
          ) : (
            <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {active.map((o) => (
                <TicketCard
                  key={o.id}
                  branchId={branchId}
                  order={o}
                  now={now}
                  kitchenDelayMinutes={delay}
                  canUpdate={can("kitchen.update")}
                  fresh={fresh.has(o.id)}
                />
              ))}
            </div>
          )
        ) : (data?.recent ?? []).length === 0 ? (
          <EmptyState
            icon={<ChefHat />}
            title="Nothing completed in the last 2 hours"
            className="min-h-[50dvh]"
          />
        ) : (
          <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {data!.recent.map((o) => (
              <CompletedTicket key={o.id} order={o} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function KitchenGate() {
  const { branchId } = useParams<{ branchId: string }>();
  const ctx = useBranchContext(branchId);
  if (ctx.isPending) return <PageSkeleton variant="cards" />;
  if (ctx.isError) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState
          title="Branch unavailable"
          message={errorMessage(ctx.error)}
          onRetry={() => void ctx.refetch()}
        />
      </div>
    );
  }
  if (!permissionChecker(ctx.data.permissions)("kitchen.view")) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState
          title="Kitchen display unavailable"
          message="Your role at this branch does not include the kitchen display."
        />
        <div className="mt-4 text-center">
          <Button variant="outline" asChild>
            <Link href={`/app/b/${branchId}`}>Back to branch</Link>
          </Button>
        </div>
      </div>
    );
  }
  return <KitchenScreen branchId={branchId} ctx={ctx.data} />;
}

/** /kitchen/[branchId] — tablet-first kitchen display system. */
export function KitchenDisplay() {
  return (
    <AuthGate>
      <KitchenGate />
    </AuthGate>
  );
}
