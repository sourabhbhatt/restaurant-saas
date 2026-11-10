"use client";

import { ArrowRight, ClipboardList, Clock, Receipt, Utensils, Wallet } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";

import {
  EmptyState,
  ErrorState,
  PageHeader,
  StatCard,
  StatusBadge,
  type StatusTone,
} from "@ros/ui/shared/feedback";
import { Button } from "@ros/ui/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@ros/ui/ui/card";
import { Skeleton } from "@ros/ui/ui/skeleton";
import { branchConsoles } from "../navigation/nav-config";
import { SetupChecklist } from "../onboarding/setup-checklist";
import { useAppLinks } from "../../app-links";
import { permissionChecker, useBranchContext } from "../session/queries";
import { ApiError, errorMessage } from "@ros/api-client";

import { chartColor, ChartCard, TrendChart } from "./charts";
import { rangeForPreset } from "./date-range-filter";
import { formatCount, formatDay, formatMoney, formatMoneyCompact } from "./format";
import { useBranchAnalytics, useBranchLive, useRecentOrders } from "./queries";

const ORDER_TONE: Record<string, StatusTone> = {
  PENDING: "warning",
  ACCEPTED: "info",
  PREPARING: "info",
  READY: "success",
  SERVED: "success",
  COMPLETED: "neutral",
  REJECTED: "danger",
  CANCELLED: "danger",
};

function RecentOrders({ branchId, currency }: { branchId: string; currency: string }) {
  const q = useRecentOrders(branchId, true);
  const timeFmt = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit" });
  return (
    <Card className="gap-3">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-base">Recent orders</CardTitle>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/app/b/${branchId}/orders`}>
            All orders <ArrowRight aria-hidden />
          </Link>
        </Button>
      </CardHeader>
      <CardContent>
        {q.isPending ? (
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : q.isError ? (
          q.error instanceof ApiError && [404, 405].includes(q.error.status) ? (
            <EmptyState
              size="compact"
              icon={<ClipboardList />}
              title="Order history isn't available yet"
              description="Recent orders will appear here."
            />
          ) : (
            <ErrorState
              size="compact"
              message={errorMessage(q.error)}
              onRetry={() => void q.refetch()}
              retrying={q.isFetching}
            />
          )
        ) : q.data.length === 0 ? (
          <EmptyState
            size="compact"
            icon={<ClipboardList />}
            title="No orders yet"
            description="New orders from tables and staff show up here."
          />
        ) : (
          <ul className="divide-y">
            {[...q.data]
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
              .slice(0, 8)
              .map((o) => (
                <li key={o.id} className="flex items-center gap-3 py-2.5 text-sm">
                  <span className="w-14 font-medium tabular-nums">#{o.orderNumber}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{o.tableName}</span>
                    <span className="text-xs text-muted-foreground">
                      {timeFmt.format(new Date(o.createdAt))} · {formatCount(o.itemCount)} items
                    </span>
                  </span>
                  <span className="hidden tabular-nums sm:inline">
                    {formatMoney(o.subtotal, o.currency || currency)}
                  </span>
                  <StatusBadge tone={ORDER_TONE[o.status] ?? "neutral"}>
                    {o.status.charAt(0) + o.status.slice(1).toLowerCase()}
                  </StatusBadge>
                </li>
              ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function WeekTrend({
  branchId,
  timezone,
  currency,
}: {
  branchId: string;
  timezone: string;
  currency: string;
}) {
  const range = rangeForPreset("7d", timezone);
  const q = useBranchAnalytics(branchId, range);
  // Permission or plan errors simply hide the section.
  if (q.isError && q.error instanceof ApiError && [402, 403].includes(q.error.status)) return null;
  return (
    <ChartCard
      title="Last 7 days"
      description="Collected per day"
      loading={q.isPending}
      action={
        <Button asChild variant="ghost" size="sm">
          <Link href={`/app/b/${branchId}/reports`}>
            Reports <ArrowRight aria-hidden />
          </Link>
        </Button>
      }
    >
      {q.isError ? (
        <ErrorState
          size="compact"
          message={errorMessage(q.error)}
          onRetry={() => void q.refetch()}
          retrying={q.isFetching}
        />
      ) : q.data ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            <span className="text-lg font-semibold text-foreground">
              {formatMoney(q.data.kpis.collected, currency)}
            </span>{" "}
            from {formatCount(q.data.kpis.totalOrders)} orders
          </p>
          <TrendChart
            data={q.data.daily}
            xKey="date"
            series={[{ key: "collected", label: "Collected", color: chartColor(0) }]}
            formatValue={(v) => formatMoney(v, currency)}
            formatAxis={(v) => formatMoneyCompact(v, currency)}
            formatX={formatDay}
            height={200}
          />
        </div>
      ) : null}
    </ChartCard>
  );
}

/** /app/b/[branchId] — live KPIs, console shortcuts, recent orders and a 7-day trend. */
export function BranchOverview() {
  const { branchId } = useParams<{ branchId: string }>();
  const ctx = useBranchContext(branchId);
  const live = useBranchLive(branchId);
  const links = useAppLinks();
  if (!ctx.data) return null; // The branch shell renders loading/error states.
  const b = ctx.data;
  const can = permissionChecker(b.permissions);
  const consoles = branchConsoles(branchId, links.ops).filter(
    (c) => !c.permission || can(c.permission),
  );
  const l = live.data;
  const loading = live.isPending;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={b.branchName}
        description={`${b.restaurantName} · live view, refreshed every 30 seconds`}
        actions={consoles.map((c) => (
          <Button key={c.href} asChild variant="outline">
            <Link href={c.href}>
              <c.icon aria-hidden /> {c.label}
            </Link>
          </Button>
        ))}
      />

      {can("workspace.update") && (
        <SetupChecklist workspaceId={b.workspaceId} branchId={branchId} />
      )}

      {live.isError ? (
        <ErrorState
          title="Couldn't load live numbers"
          message={errorMessage(live.error)}
          onRetry={() => void live.refetch()}
          retrying={live.isFetching}
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {(loading || l?.orders) && (
            <StatCard
              label="Pending orders"
              value={l?.orders ? formatCount(l.orders.pending) : "—"}
              icon={<Clock />}
              loading={loading}
              title="Waiting for a waiter to accept"
            />
          )}
          {(loading || l?.orders) && (
            <StatCard
              label="In the kitchen"
              value={
                l?.orders
                  ? `${formatCount(l.orders.inKitchen)} · ${formatCount(l.orders.ready)} ready`
                  : "—"
              }
              icon={<Utensils />}
              loading={loading}
            />
          )}
          {(loading || l?.tables) && (
            <StatCard
              label="Active tables"
              value={
                l?.tables ? `${formatCount(l.tables.active)} / ${formatCount(l.tables.total)}` : "—"
              }
              icon={<ClipboardList />}
              loading={loading}
              title={l?.tables ? `${l.tables.billRequested} asked for the bill` : undefined}
            />
          )}
          {(loading || l?.bills) && (
            <StatCard
              label="Open bills"
              value={l?.bills ? formatCount(l.bills.open) : "—"}
              icon={<Receipt />}
              loading={loading}
              title={
                l?.bills ? `${formatMoney(l.bills.outstanding, b.currency)} outstanding` : undefined
              }
            />
          )}
          {(loading || l?.bills) && (
            <StatCard
              label="Collected today"
              value={l?.bills ? formatMoney(l.bills.collectedToday, b.currency) : "—"}
              icon={<Wallet />}
              loading={loading}
            />
          )}
          {(loading || l?.orders) && (
            <StatCard
              label="Orders today"
              value={l?.orders ? formatCount(l.orders.today) : "—"}
              loading={loading}
            />
          )}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {can("orders.view") && <RecentOrders branchId={branchId} currency={b.currency} />}
        <WeekTrend branchId={branchId} timezone={b.timezone} currency={b.currency} />
      </div>

      {consoles.length === 0 && !can("orders.view") && (
        <p className="text-sm text-muted-foreground">
          Your role at this branch has no operational consoles. Use the menu to open the pages
          available to you.
        </p>
      )}
    </div>
  );
}
