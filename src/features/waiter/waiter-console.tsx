"use client";

import { ArrowLeft, BellRing, ChefHat, ClipboardCheck, HandPlatter, History, LayoutGrid, Inbox } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { EmptyState, ErrorState, PageSkeleton, StatusBadge } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BranchContextDto } from "@/contracts/structure";
import type { OrderDto } from "@/contracts/orders";
import { formatMoney } from "@/domain/shared/money";
import { errorMessage } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { OrderDetailSheet } from "@/features/orders/order-detail-sheet";
import { OrderStatusBadge } from "@/features/orders/order-ui";
import { useBranchOrders } from "@/features/orders/queries";
import { formatClock, formatElapsed, useNow } from "@/features/orders/use-now";
import { useAlertSound, useNewIds } from "@/features/realtime/alert-sound";
import { ConnectionStatus } from "@/features/realtime/connection-status";
import { SoundControl } from "@/features/realtime/sound-control";
import { useBranchEvents } from "@/features/realtime/use-branch-events";
import { AuthGate } from "@/features/session/auth-gate";
import { permissionChecker, useBranchContext } from "@/features/session/queries";

import { WaiterOrderCard } from "./order-card";
import { useBranchSessions } from "./queries";
import { TableDrawer } from "./table-drawer";
import { TablesGrid } from "./tables-grid";

type Lane = "new" | "kitchen" | "ready";

const time = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : 0);

function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function LaneColumn({
  title,
  icon,
  count,
  tone,
  children,
  empty,
  className,
}: {
  title: string;
  icon: ReactNode;
  count: number;
  tone: "warning" | "info" | "success";
  children: ReactNode;
  empty: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3", className)} aria-label={title}>
      <h2 className="hidden items-center gap-2 text-sm font-semibold md:flex">
        {icon}
        {title}
        <StatusBadge tone={tone}>{count}</StatusBadge>
      </h2>
      {count === 0 ? empty : <div className="flex flex-col gap-3">{children}</div>}
    </section>
  );
}

function WaiterScreen({ branchId, ctx }: { branchId: string; ctx: BranchContextDto }) {
  const can = permissionChecker(ctx.permissions);
  const realtime = useBranchEvents(branchId);
  const now = useNow(5_000);
  const [tab, setTab] = useState("orders");
  const [lane, setLane] = useState<Lane>("new");
  const [tableId, setTableId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const today = useMemo(startOfToday, []);

  const active = useBranchOrders(
    branchId,
    { status: "PENDING,ACCEPTED,PREPARING,READY", limit: 200 },
    { refetchInterval: realtime.pollInterval },
  );
  const sessions = useBranchSessions(branchId, {
    refetchInterval: realtime.pollInterval,
    enabled: can("tables.view"),
  });
  const history = useBranchOrders(
    branchId,
    { status: "SERVED,COMPLETED,REJECTED,CANCELLED", from: today, limit: 100 },
    { refetchInterval: tab === "history" ? realtime.pollInterval : false, enabled: tab === "history" },
  );

  const sound = useAlertSound(
    `ros:waiter-sound:${branchId}`,
    sessions.data?.waiterSoundEnabled ?? true,
  );

  const lanes = useMemo(() => {
    const all = active.data ?? [];
    return {
      new: all.filter((o) => o.status === "PENDING").sort((a, b) => time(a.createdAt) - time(b.createdAt)),
      kitchen: all
        .filter((o) => o.status === "ACCEPTED" || o.status === "PREPARING")
        .sort((a, b) => time(a.acceptedAt) - time(b.acceptedAt)),
      ready: all.filter((o) => o.status === "READY").sort((a, b) => time(a.readyAt) - time(b.readyAt)),
    };
  }, [active.data]);

  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const onNewPending = useCallback(
    (ids: string[]) => {
      sound.play("new");
      const orders = (active.data ?? []).filter((o) => ids.includes(o.id));
      for (const o of orders) {
        toast.info(`New order #${o.orderNumber} · ${o.tableName}`, {
          description: o.items.map((i) => `${i.quantity}× ${i.itemName}`).join(", "),
          action: { label: "View", onClick: () => setOrderId(o.id) },
        });
      }
      setFresh((s) => new Set([...s, ...ids]));
      setTimeout(() => setFresh((s) => new Set([...s].filter((x) => !ids.includes(x)))), 15_000);
    },
    [active.data, sound],
  );
  useNewIds(active.data ? lanes.new.map((o) => o.id) : undefined, onNewPending);

  const onNewReady = useCallback(() => sound.play("ready"), [sound]);
  useNewIds(active.data ? lanes.ready.map((o) => o.id) : undefined, onNewReady);

  const tables = sessions.data?.tables ?? [];
  const billRequests = tables
    .filter((t) => t.status === "BILL_REQUESTED")
    .sort((a, b) => time(a.session?.billRequestedAt) - time(b.session?.billRequestedAt));
  const selectedTable = tables.find((t) => t.tableId === tableId) ?? null;
  const currency = sessions.data?.currency ?? ctx.currency;

  const card = (o: OrderDto) => (
    <WaiterOrderCard
      key={o.id}
      branchId={branchId}
      order={o}
      can={can}
      now={now}
      onOpen={setOrderId}
      highlight={fresh.has(o.id)}
    />
  );

  const ordersBody = active.isPending ? (
    <div className="grid gap-4 md:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} className="h-48 rounded-xl" />
      ))}
    </div>
  ) : active.isError && !active.data ? (
    <ErrorState message={errorMessage(active.error)} onRetry={() => void active.refetch()} />
  ) : (
    <>
      <div className="mb-3 grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 md:hidden" role="tablist" aria-label="Order lanes">
        {(
          [
            ["new", "New", lanes.new.length],
            ["kitchen", "Kitchen", lanes.kitchen.length],
            ["ready", "Ready", lanes.ready.length],
          ] as const
        ).map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={lane === key}
            onClick={() => setLane(key)}
            className={cn(
              "flex min-h-10 items-center justify-center gap-1.5 rounded-md text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
              lane === key ? "bg-background shadow-sm" : "text-muted-foreground",
            )}
          >
            {label}
            <span
              className={cn(
                "min-w-5 rounded-full px-1.5 text-xs tabular-nums",
                key === "new" && count > 0 ? "bg-warning text-warning-foreground" : "bg-muted-foreground/15",
              )}
            >
              {count}
            </span>
          </button>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <LaneColumn
          title="New"
          icon={<Inbox className="size-4" aria-hidden />}
          count={lanes.new.length}
          tone="warning"
          className={cn(lane !== "new" && "max-md:hidden")}
          empty={<EmptyState size="compact" title="No new orders" description="New QR orders appear here for approval." />}
        >
          {lanes.new.map(card)}
        </LaneColumn>
        <LaneColumn
          title="In kitchen"
          icon={<ChefHat className="size-4" aria-hidden />}
          count={lanes.kitchen.length}
          tone="info"
          className={cn(lane !== "kitchen" && "max-md:hidden")}
          empty={<EmptyState size="compact" title="Kitchen is clear" />}
        >
          {lanes.kitchen.map(card)}
        </LaneColumn>
        <LaneColumn
          title="Ready to serve"
          icon={<HandPlatter className="size-4" aria-hidden />}
          count={lanes.ready.length}
          tone="success"
          className={cn(lane !== "ready" && "max-md:hidden")}
          empty={<EmptyState size="compact" title="Nothing waiting at the pass" />}
        >
          {lanes.ready.map(card)}
        </LaneColumn>
      </div>
    </>
  );

  const pendingTotal = lanes.new.length;

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-3 px-4">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href={`/app/b/${branchId}`} aria-label="Back to branch dashboard">
              <ArrowLeft aria-hidden />
            </Link>
          </Button>
          <div className="min-w-0">
            <p className="truncate leading-tight font-semibold">{ctx.branchName}</p>
            <p className="truncate text-xs text-muted-foreground">{ctx.restaurantName} · Waiter</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {pendingTotal > 0 && (
              <StatusBadge tone="warning" dot pulse className="hidden sm:inline-flex">
                {pendingTotal} to approve
              </StatusBadge>
            )}
            <ConnectionStatus status={realtime.status} lastSyncedAt={active.dataUpdatedAt} />
            <SoundControl sound={sound} />
          </div>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="mx-auto w-full max-w-[1600px] flex-1 gap-4 p-4">
        <TabsList className="w-full sm:w-fit">
          <TabsTrigger value="orders">
            <ClipboardCheck aria-hidden /> Orders
            {pendingTotal > 0 && (
              <span className="rounded-full bg-warning px-1.5 text-xs text-warning-foreground tabular-nums">
                {pendingTotal}
              </span>
            )}
          </TabsTrigger>
          {can("tables.view") && (
            <TabsTrigger value="tables">
              <LayoutGrid aria-hidden /> Tables
            </TabsTrigger>
          )}
          {can("tables.view") && (
            <TabsTrigger value="bills">
              <BellRing aria-hidden /> <span className="max-sm:sr-only">Bill requests</span>
              {billRequests.length > 0 && (
                <span className="rounded-full bg-warning px-1.5 text-xs text-warning-foreground tabular-nums">
                  {billRequests.length}
                </span>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="history">
            <History aria-hidden /> <span className="max-sm:sr-only">History</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="orders">{ordersBody}</TabsContent>

        {can("tables.view") && (
          <TabsContent value="tables">
            {sessions.isPending ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="h-28 rounded-xl" />
                ))}
              </div>
            ) : sessions.isError && !sessions.data ? (
              <ErrorState message={errorMessage(sessions.error)} onRetry={() => void sessions.refetch()} />
            ) : (
              <TablesGrid tables={tables} currency={currency} now={now} onSelect={setTableId} />
            )}
          </TabsContent>
        )}

        {can("tables.view") && (
          <TabsContent value="bills">
            {sessions.isPending ? (
              <Skeleton className="h-32 rounded-xl" />
            ) : sessions.isError && !sessions.data ? (
              <ErrorState message={errorMessage(sessions.error)} onRetry={() => void sessions.refetch()} />
            ) : billRequests.length === 0 ? (
              <EmptyState
                icon={<BellRing />}
                title="No bill requests"
                description="When guests ask for the bill from their phone, the table shows up here."
              />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {billRequests.map((t) => (
                  <li key={t.tableId} className="flex flex-col gap-3 rounded-xl border-2 border-warning bg-warning/10 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-lg font-semibold">{t.tableName}</p>
                        <p className="text-sm text-muted-foreground">
                          Requested {formatClock(t.session?.billRequestedAt)} ·{" "}
                          {formatElapsed(t.session?.billRequestedAt, now)} ago
                        </p>
                      </div>
                      <p className="font-semibold tabular-nums">
                        {formatMoney(t.session?.billableSubtotal ?? 0, currency)}
                      </p>
                    </div>
                    {t.session && t.session.pendingCount > 0 && (
                      <p className="text-sm text-warning-foreground dark:text-warning">
                        {t.session.pendingCount} order(s) still awaiting approval
                      </p>
                    )}
                    <Button size="lg" onClick={() => setTableId(t.tableId)}>
                      Open table
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </TabsContent>
        )}

        <TabsContent value="history">
          {history.isPending ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : history.isError && !history.data ? (
            <ErrorState message={errorMessage(history.error)} onRetry={() => void history.refetch()} />
          ) : (history.data ?? []).length === 0 ? (
            <EmptyState icon={<History />} title="Nothing finished yet today" />
          ) : (
            <ul className="divide-y rounded-xl border">
              {history.data!.map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    onClick={() => setOrderId(o.id)}
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left outline-none hover:bg-muted/50 focus-visible:bg-muted/60"
                  >
                    <span className="w-14 font-semibold tabular-nums">#{o.orderNumber}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{o.tableName}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {o.rejectionReason ?? o.cancellationReason ?? o.items.map((i) => `${i.quantity}× ${i.itemName}`).join(", ")}
                      </span>
                    </span>
                    <span className="hidden text-sm text-muted-foreground sm:block">{formatClock(o.createdAt)}</span>
                    <OrderStatusBadge status={o.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <TableDrawer
        branchId={branchId}
        table={selectedTable}
        currency={currency}
        can={can}
        now={now}
        pollInterval={realtime.pollInterval}
        onOpenChange={(o) => !o && setTableId(null)}
      />
      <OrderDetailSheet
        branchId={branchId}
        orderId={orderId}
        onOpenChange={(o) => !o && setOrderId(null)}
        can={can}
      />
    </div>
  );
}

function WaiterGate() {
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
  const can = permissionChecker(ctx.data.permissions);
  if (!can("orders.view")) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState
          title="Waiter console unavailable"
          message="Your role at this branch does not include viewing orders."
        />
        <div className="mt-4 text-center">
          <Button variant="outline" asChild>
            <Link href={`/app/b/${branchId}`}>Back to branch</Link>
          </Button>
        </div>
      </div>
    );
  }
  return <WaiterScreen branchId={branchId} ctx={ctx.data} />;
}

/** /waiter/[branchId] — full-screen waiter console. */
export function WaiterConsole() {
  return (
    <AuthGate>
      <WaiterGate />
    </AuthGate>
  );
}
