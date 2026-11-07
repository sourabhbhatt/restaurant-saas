"use client";

import { useParams } from "next/navigation";

import { DataTable, PageHeader, PageSkeleton, StatCard } from "@/components/shared/feedback";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BranchAnalyticsDto } from "@ros/contracts/analytics";
import { useBranchContext } from "@/features/session/queries";

import {
  BarList,
  chartColor,
  ChartCard,
  ColumnChart,
  DonutChart,
  methodColor,
  Meter,
  PeakHoursHeatmap,
  TrendChart,
} from "./charts";
import { DateRangeFilter, useDateRange } from "./date-range-filter";
import {
  deltaLabel,
  formatCount,
  formatCountCompact,
  formatDay,
  formatLongDay,
  formatMinutes,
  formatMoney,
  formatMoneyCompact,
  formatPercent,
  PAYMENT_METHOD_LABELS,
} from "./format";
import { useBranchAnalytics } from "./queries";
import { AnalyticsError, DefinitionsNote, KpiGrid, NoOrders } from "./shared";

type Data = BranchAnalyticsDto;

function SalesTab({ d, dimmed }: { d: Data; dimmed: boolean }) {
  const cur = d.branch.currency;
  const money = (v: number) => formatMoney(v, cur);
  const axis = (v: number) => formatMoneyCompact(v, cur);
  const empty = d.kpis.totalOrders === 0 && d.kpis.collected === 0 && d.kpis.billed === 0;
  return (
    <div className="flex flex-col gap-4">
      <KpiGrid
        kpis={d.kpis}
        deltas={d.deltas}
        currency={cur}
        days={d.range.days}
        pendingNow={d.kpis.pendingNow}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          title="Revenue by day"
          description="Collected vs billed"
          className="lg:col-span-2"
          dimmed={dimmed}
        >
          {empty ? (
            <NoOrders />
          ) : (
            <TrendChart
              data={d.daily}
              xKey="date"
              series={[
                { key: "collected", label: "Collected", color: chartColor(0) },
                { key: "billed", label: "Billed", color: chartColor(1) },
              ]}
              formatValue={money}
              formatAxis={axis}
              formatX={formatDay}
            />
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
              formatValue={money}
              centerValue={formatMoneyCompact(d.kpis.collected, cur)}
              centerLabel="collected"
            />
          ) : (
            <NoOrders />
          )}
        </ChartCard>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Orders by day" description="All orders placed" dimmed={dimmed}>
          {d.kpis.totalOrders ? (
            <ColumnChart
              data={d.daily}
              xKey="date"
              yKey="orders"
              label="Orders"
              formatValue={(v) => formatCount(v)}
              formatAxis={formatCountCompact}
              formatX={formatDay}
            />
          ) : (
            <NoOrders />
          )}
        </ChartCard>
        <ChartCard
          title="Peak hours"
          description={`Orders by weekday and hour (${d.branch.timezone})`}
          dimmed={dimmed}
        >
          <PeakHoursHeatmap cells={d.peakHours} />
        </ChartCard>
      </div>
      <ChartCard title="Daily breakdown" dimmed={dimmed}>
        <DataTable
          aria-label="Daily breakdown"
          rows={[...d.daily].reverse()}
          rowKey="date"
          columns={[
            { id: "date", header: "Date", cell: (r) => formatLongDay(r.date) },
            { id: "orders", header: "Orders", align: "right", cell: (r) => formatCount(r.orders) },
            {
              id: "value",
              header: "Order value",
              align: "right",
              cell: (r) => money(r.orderValue),
            },
            { id: "billed", header: "Billed", align: "right", cell: (r) => money(r.billed) },
            {
              id: "collected",
              header: "Collected",
              align: "right",
              cell: (r) => money(r.collected),
            },
          ]}
        />
      </ChartCard>
      <DefinitionsNote />
    </div>
  );
}

function MenuTab({ d, dimmed }: { d: Data; dimmed: boolean }) {
  const cur = d.branch.currency;
  const money = (v: number) => formatMoney(v, cur);
  if (!d.topItems.length) return <NoOrders />;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Top items" description="By quantity sold" dimmed={dimmed}>
          <BarList
            data={d.topItems}
            nameKey="name"
            valueKey="quantity"
            label="Sold"
            formatValue={formatCount}
          />
        </ChartCard>
        <ChartCard title="Categories" description="By revenue" dimmed={dimmed}>
          <BarList
            data={d.categories}
            nameKey="category"
            valueKey="revenue"
            label="Revenue"
            color={chartColor(1)}
            formatValue={money}
            formatAxis={(v) => formatMoneyCompact(v, cur)}
          />
        </ChartCard>
      </div>
      <ChartCard
        title="Item performance"
        description="Top 10 items from order snapshots; rejected and cancelled orders excluded"
        dimmed={dimmed}
      >
        <DataTable
          aria-label="Item performance"
          rows={d.topItems}
          rowKey="name"
          columns={[
            {
              id: "name",
              header: "Item",
              cell: (r) => <span className="font-medium">{r.name}</span>,
            },
            { id: "cat", header: "Category", cell: (r) => r.category ?? "—" },
            { id: "qty", header: "Qty", align: "right", cell: (r) => formatCount(r.quantity) },
            { id: "orders", header: "Orders", align: "right", cell: (r) => formatCount(r.orders) },
            { id: "rev", header: "Revenue", align: "right", cell: (r) => money(r.revenue) },
          ]}
        />
      </ChartCard>
      <ChartCard title="Category performance" dimmed={dimmed}>
        <DataTable
          aria-label="Category performance"
          rows={d.categories}
          rowKey="category"
          columns={[
            {
              id: "cat",
              header: "Category",
              cell: (r) => <span className="font-medium">{r.category}</span>,
            },
            { id: "items", header: "Items", align: "right", cell: (r) => formatCount(r.items) },
            { id: "qty", header: "Qty", align: "right", cell: (r) => formatCount(r.quantity) },
            { id: "rev", header: "Revenue", align: "right", cell: (r) => money(r.revenue) },
          ]}
        />
      </ChartCard>
    </div>
  );
}

function KitchenTab({ d, dimmed }: { d: Data; dimmed: boolean }) {
  const k = d.kitchen;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Avg prep time"
          value={formatMinutes(k.avgPrepMinutes)}
          title="From accepted to ready"
        />
        <StatCard
          label="Avg wait to accept"
          value={formatMinutes(k.avgWaitMinutes)}
          title="From placed to accepted"
        />
        <StatCard
          label="Delayed orders"
          value={formatCount(k.delayedOrders)}
          title={`Prep took longer than ${k.delayThresholdMinutes} minutes`}
        />
        <StatCard
          label="Orders prepared"
          value={`${formatCount(k.ordersCompleted)} / ${formatCount(k.ordersAccepted)}`}
          title="Orders that reached Ready / orders accepted"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        An order is delayed when preparation (accepted → ready) exceeds the branch threshold of{" "}
        {k.delayThresholdMinutes} minutes, or it is still cooking past it.
      </p>
      <ChartCard
        title="Prep time by item"
        description="Average accepted → ready time of orders containing the item"
        dimmed={dimmed}
      >
        {k.items.length ? (
          <div className="flex flex-col gap-4">
            <BarList
              data={k.items.filter((i) => i.avgPrepMinutes !== null)}
              nameKey="name"
              valueKey="avgPrepMinutes"
              label="Avg prep"
              color={chartColor(2)}
              formatValue={(v) => formatMinutes(v)}
              formatAxis={(v) => `${v}m`}
            />
            <DataTable
              aria-label="Prep time by item"
              rows={k.items}
              rowKey="name"
              columns={[
                {
                  id: "name",
                  header: "Item",
                  cell: (r) => <span className="font-medium">{r.name}</span>,
                },
                {
                  id: "orders",
                  header: "Orders",
                  align: "right",
                  cell: (r) => formatCount(r.orders),
                },
                { id: "qty", header: "Qty", align: "right", cell: (r) => formatCount(r.quantity) },
                {
                  id: "prep",
                  header: "Avg prep",
                  align: "right",
                  cell: (r) => formatMinutes(r.avgPrepMinutes),
                },
              ]}
            />
          </div>
        ) : (
          <NoOrders />
        )}
      </ChartCard>
    </div>
  );
}

function CashierTab({ d, dimmed }: { d: Data; dimmed: boolean }) {
  const cur = d.branch.currency;
  const money = (v: number) => formatMoney(v, cur);
  const c = d.cashier;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Total collections"
          value={money(c.totalCollections)}
          delta={d.deltas.collected ?? undefined}
          deltaLabel={deltaLabel(d.range.days)}
        />
        <StatCard
          label="Outstanding"
          value={money(c.outstandingBalance)}
          title="Balance still due on bills issued in this period"
        />
        <StatCard
          label="Partially paid bills"
          value={formatCount(c.partiallyPaidBills)}
          title={`${formatCount(c.unpaidBills)} unpaid`}
        />
        <StatCard
          label="Refunds"
          value={money(c.refundsTotal)}
          title={`${formatCount(c.refundCount)} refunds`}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard title="Collections by method" dimmed={dimmed}>
          {c.byMethod.length ? (
            <DonutChart
              data={c.byMethod.map((m) => ({
                name: PAYMENT_METHOD_LABELS[m.method] ?? m.method,
                value: m.net,
                color: methodColor(m.method),
              }))}
              formatValue={money}
            />
          ) : (
            <NoOrders />
          )}
        </ChartCard>
        <ChartCard title="Method details" className="lg:col-span-2" dimmed={dimmed}>
          <DataTable
            aria-label="Payment methods"
            rows={c.byMethod}
            rowKey="method"
            empty={<NoOrders />}
            columns={[
              {
                id: "m",
                header: "Method",
                cell: (r) => (
                  <span className="font-medium">{PAYMENT_METHOD_LABELS[r.method] ?? r.method}</span>
                ),
              },
              {
                id: "count",
                header: "Payments",
                align: "right",
                cell: (r) => formatCount(r.paymentCount),
              },
              { id: "paid", header: "Received", align: "right", cell: (r) => money(r.payments) },
              { id: "ref", header: "Refunded", align: "right", cell: (r) => money(r.refunds) },
              { id: "net", header: "Net", align: "right", cell: (r) => money(r.net) },
            ]}
          />
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              ["Payments", formatCount(c.paymentCount)],
              ["Voided payments", formatCount(c.voidedPayments)],
              ["Unpaid bills", formatCount(c.unpaidBills)],
              ["Discounts given", money(c.discountsTotal)],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="font-medium tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
        </ChartCard>
      </div>
    </div>
  );
}

function TablesTab({ d, dimmed }: { d: Data; dimmed: boolean }) {
  const t = d.tables;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        <StatCard label="Table sessions" value={formatCount(t.totalSessions)} />
        <StatCard label="Avg session" value={formatMinutes(t.avgSessionMinutes)} />
        <StatCard
          label="Occupancy"
          value={formatPercent(t.occupancyPercent)}
          title={t.method}
          className="col-span-2 lg:col-span-1"
        />
      </div>
      <ChartCard title="By table" description={t.method} dimmed={dimmed}>
        <DataTable
          aria-label="Table utilization"
          rows={t.tables}
          rowKey="tableId"
          empty={<NoOrders />}
          columns={[
            {
              id: "name",
              header: "Table",
              cell: (r) => (
                <span className="flex flex-col">
                  <span className="font-medium">{r.name}</span>
                  {r.section && <span className="text-xs text-muted-foreground">{r.section}</span>}
                </span>
              ),
            },
            { id: "cap", header: "Seats", align: "right", cell: (r) => formatCount(r.capacity) },
            {
              id: "sessions",
              header: "Sessions",
              align: "right",
              cell: (r) => formatCount(r.sessions),
            },
            {
              id: "avg",
              header: "Avg session",
              align: "right",
              cell: (r) => formatMinutes(r.avgSessionMinutes),
            },
            {
              id: "occ",
              header: "Occupancy",
              className: "w-40",
              cell: (r) => (
                <div className="flex items-center gap-2">
                  <Meter value={r.occupancyPercent} label={`${r.name} occupancy`} />
                  <span className="w-12 text-right text-xs tabular-nums">
                    {formatPercent(r.occupancyPercent)}
                  </span>
                </div>
              ),
            },
          ]}
        />
      </ChartCard>
    </div>
  );
}

/** /app/b/[branchId]/reports — Sales, Menu performance, Kitchen, Cashier and Tables. */
export function BranchReports() {
  const { branchId } = useParams<{ branchId: string }>();
  const ctx = useBranchContext(branchId);
  const tz = ctx.data?.timezone;
  const [range, setRange] = useDateRange(tz);
  const q = useBranchAnalytics(branchId, range, Boolean(ctx.data));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Reports"
        description={
          ctx.data
            ? `${ctx.data.restaurantName} · ${ctx.data.branchName}`
            : "Sales, menu, kitchen, cashier and table performance"
        }
      />
      <DateRangeFilter value={range} onChange={setRange} timeZone={tz} />
      {q.isPending ? (
        <PageSkeleton variant="cards" count={8} />
      ) : q.isError ? (
        <AnalyticsError
          error={q.error}
          onRetry={() => void q.refetch()}
          retrying={q.isFetching}
          upgradeHref={ctx.data ? `/app/w/${ctx.data.workspaceId}/subscription` : undefined}
        />
      ) : (
        <Tabs defaultValue="sales" className="gap-4">
          <TabsList className="max-w-full justify-start overflow-x-auto">
            <TabsTrigger value="sales">Sales</TabsTrigger>
            <TabsTrigger value="menu">Menu performance</TabsTrigger>
            <TabsTrigger value="kitchen">Kitchen</TabsTrigger>
            <TabsTrigger value="cashier">Cashier</TabsTrigger>
            <TabsTrigger value="tables">Tables</TabsTrigger>
          </TabsList>
          <TabsContent value="sales">
            <SalesTab d={q.data} dimmed={q.isPlaceholderData} />
          </TabsContent>
          <TabsContent value="menu">
            <MenuTab d={q.data} dimmed={q.isPlaceholderData} />
          </TabsContent>
          <TabsContent value="kitchen">
            <KitchenTab d={q.data} dimmed={q.isPlaceholderData} />
          </TabsContent>
          <TabsContent value="cashier">
            <CashierTab d={q.data} dimmed={q.isPlaceholderData} />
          </TabsContent>
          <TabsContent value="tables">
            <TablesTab d={q.data} dimmed={q.isPlaceholderData} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
