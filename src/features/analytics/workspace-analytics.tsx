"use client";

import { Sparkles, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import {
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  PageSkeleton,
} from "@/components/shared/feedback";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { WorkspaceAnalyticsDto } from "@ros/contracts/analytics";

import { BranchFilter, type BranchFilterValue } from "./branch-filter";
import { BarList, chartColor, ChartCard, DonutChart, methodColor, TrendChart } from "./charts";
import { DateRangeFilter, useDateRange } from "./date-range-filter";
import {
  formatCount,
  formatDay,
  formatMinutes,
  formatMoney,
  formatMoneyCompact,
  formatPercent,
  PAYMENT_METHOD_LABELS,
} from "./format";
import { useWorkspaceAnalytics } from "./queries";
import { AnalyticsError, DefinitionsNote, KpiGrid, NoOrders } from "./shared";

function Delta({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const tone =
    value > 0 ? "text-success" : value < 0 ? "text-destructive" : "text-muted-foreground";
  return (
    <span className={tone}>
      {value > 0 ? "+" : value < 0 ? "−" : ""}
      {formatPercent(Math.abs(value))}
    </span>
  );
}

function BranchComparison({
  d,
  workspaceId,
  dimmed,
}: {
  d: WorkspaceAnalyticsDto;
  workspaceId: string;
  dimmed: boolean;
}) {
  const cur = d.currency;
  const money = (v: number) => formatMoney(v, cur);
  if (!d.branchComparison.available) {
    return (
      <ChartCard title="Branch comparison">
        <EmptyState
          size="compact"
          icon={<Sparkles />}
          title="Compare branches with Advanced analytics"
          description={d.branchComparison.error.message}
          action={
            <Button asChild>
              <Link href={`/app/w/${workspaceId}/subscription`}>View plans</Link>
            </Button>
          }
        />
      </ChartCard>
    );
  }
  const rows = [...d.branchComparison.data].sort((a, b) => b.collected - a.collected);
  return (
    <ChartCard
      title="Branch comparison"
      description="Collected per branch, with change vs the previous period"
      dimmed={dimmed}
    >
      <div className="flex flex-col gap-4">
        {rows.length > 1 && (
          <BarList
            data={rows.map((r) => ({ ...r, label: `${r.restaurantName} · ${r.branchName}` }))}
            nameKey="label"
            valueKey="collected"
            label="Collected"
            formatValue={money}
            formatAxis={(v) => formatMoneyCompact(v, cur)}
          />
        )}
        <DataTable
          aria-label="Branch comparison"
          rows={rows}
          rowKey="branchId"
          empty={<NoOrders />}
          columns={[
            {
              id: "branch",
              header: "Branch",
              cell: (r) => (
                <Link
                  href={`/app/b/${r.branchId}/reports`}
                  className="flex flex-col hover:underline"
                >
                  <span className="font-medium">{r.branchName}</span>
                  <span className="text-xs text-muted-foreground">{r.restaurantName}</span>
                </Link>
              ),
            },
            { id: "orders", header: "Orders", align: "right", cell: (r) => formatCount(r.orders) },
            {
              id: "cancel",
              header: "Cancelled",
              align: "right",
              cell: (r) => formatCount(r.cancelledOrders),
            },
            {
              id: "aov",
              header: "AOV",
              align: "right",
              cell: (r) => formatMoney(r.averageOrderValue, r.currency),
            },
            {
              id: "billed",
              header: "Billed",
              align: "right",
              cell: (r) => formatMoney(r.billed, r.currency),
            },
            {
              id: "collected",
              header: "Collected",
              align: "right",
              cell: (r) => formatMoney(r.collected, r.currency),
            },
            {
              id: "delta",
              header: "Change",
              align: "right",
              cell: (r) => <Delta value={r.collectedDelta} />,
            },
            {
              id: "prep",
              header: "Avg prep",
              align: "right",
              cell: (r) => formatMinutes(r.avgPrepMinutes),
            },
          ]}
        />
      </div>
    </ChartCard>
  );
}

/** /app/w/[workspaceId]/analytics — consolidated analytics with period and branch filters. */
export function WorkspaceAnalytics() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [range, setRange] = useDateRange();
  const [scope, setScope] = useState<BranchFilterValue>({});
  const q = useWorkspaceAnalytics(workspaceId, { from: range.from, to: range.to, ...scope });
  const d = q.data;
  const dimmed = q.isPlaceholderData;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Analytics"
        description="Revenue, orders and branch performance across your restaurants"
      />
      <FilterBar aria-label="Report filters" className="items-start sm:items-start">
        <DateRangeFilter value={range} onChange={setRange} className="flex-1" />
        <BranchFilter workspaceId={workspaceId} value={scope} onChange={setScope} />
      </FilterBar>

      {q.isPending ? (
        <PageSkeleton variant="cards" count={8} />
      ) : q.isError ? (
        <AnalyticsError
          error={q.error}
          onRetry={() => void q.refetch()}
          retrying={q.isFetching}
          upgradeHref={`/app/w/${workspaceId}/subscription`}
        />
      ) : d ? (
        <>
          {d.mixedCurrencies && (
            <Alert>
              <TriangleAlert aria-hidden />
              <AlertTitle>Branches use different currencies</AlertTitle>
              <AlertDescription>
                Totals add amounts across currencies. Filter to one restaurant or branch for exact
                figures.
              </AlertDescription>
            </Alert>
          )}
          <KpiGrid
            kpis={d.kpis}
            deltas={d.deltas}
            currency={d.currency}
            days={d.range.days}
            pendingNow={d.kpis.pendingNow}
          />
          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard
              title="Revenue trend"
              description="Collected vs billed per day"
              className="lg:col-span-2"
              dimmed={dimmed}
            >
              {d.kpis.totalOrders || d.kpis.collected || d.kpis.billed ? (
                <TrendChart
                  data={d.daily}
                  xKey="date"
                  series={[
                    { key: "collected", label: "Collected", color: chartColor(0) },
                    { key: "billed", label: "Billed", color: chartColor(1) },
                  ]}
                  formatValue={(v) => formatMoney(v, d.currency)}
                  formatAxis={(v) => formatMoneyCompact(v, d.currency)}
                  formatX={formatDay}
                />
              ) : (
                <NoOrders />
              )}
            </ChartCard>
            <ChartCard title="Payment methods" description="Net collected" dimmed={dimmed}>
              {d.paymentMethods.length ? (
                <DonutChart
                  data={d.paymentMethods.map((m) => ({
                    name: PAYMENT_METHOD_LABELS[m.method] ?? m.method,
                    value: m.net,
                    color: methodColor(m.method),
                  }))}
                  formatValue={(v) => formatMoney(v, d.currency)}
                  centerValue={formatMoneyCompact(d.kpis.collected, d.currency)}
                  centerLabel="collected"
                />
              ) : (
                <NoOrders />
              )}
            </ChartCard>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Orders trend" description="Orders placed per day" dimmed={dimmed}>
              {d.kpis.totalOrders ? (
                <TrendChart
                  data={d.daily}
                  xKey="date"
                  series={[{ key: "orders", label: "Orders", color: chartColor(2) }]}
                  formatValue={(v) => formatCount(v)}
                  formatX={formatDay}
                  height={220}
                />
              ) : (
                <NoOrders />
              )}
            </ChartCard>
            <ChartCard title="Top items" description="By quantity sold" dimmed={dimmed}>
              {d.topItems.length ? (
                <BarList
                  data={d.topItems}
                  nameKey="name"
                  valueKey="quantity"
                  label="Sold"
                  formatValue={formatCount}
                />
              ) : (
                <NoOrders />
              )}
            </ChartCard>
          </div>
          <ChartCard title="Restaurants" dimmed={dimmed}>
            <DataTable
              aria-label="Restaurants"
              rows={d.restaurants}
              rowKey="restaurantId"
              empty={<NoOrders />}
              columns={[
                {
                  id: "name",
                  header: "Restaurant",
                  cell: (r) => <span className="font-medium">{r.restaurantName}</span>,
                },
                {
                  id: "branches",
                  header: "Branches",
                  align: "right",
                  cell: (r) => formatCount(r.branches),
                },
                {
                  id: "orders",
                  header: "Orders",
                  align: "right",
                  cell: (r) => formatCount(r.orders),
                },
                {
                  id: "value",
                  header: "Order value",
                  align: "right",
                  cell: (r) => formatMoney(r.orderValue, d.currency),
                },
                {
                  id: "billed",
                  header: "Billed",
                  align: "right",
                  cell: (r) => formatMoney(r.billed, d.currency),
                },
                {
                  id: "collected",
                  header: "Collected",
                  align: "right",
                  cell: (r) => formatMoney(r.collected, d.currency),
                },
              ]}
            />
          </ChartCard>
          <BranchComparison d={d} workspaceId={workspaceId} dimmed={dimmed} />
          <DefinitionsNote />
        </>
      ) : null}
    </div>
  );
}
