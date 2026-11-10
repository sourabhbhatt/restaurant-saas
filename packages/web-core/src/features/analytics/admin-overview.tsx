"use client";

import { Building2, GitBranch, Store, Users } from "lucide-react";
import Link from "next/link";

import {
  DataTable,
  PageHeader,
  PageSkeleton,
  StatCard,
  StatusBadge,
  type StatusTone,
} from "@ros/ui/shared/feedback";
import type { SubscriptionPhase } from "@ros/domain/subscriptions/entitlements";

import { chartColor, ChartCard, ColumnChart, DonutChart, TrendChart } from "./charts";
import { formatCount, formatCountCompact, formatDay, formatPercent } from "./format";
import { useAdminAnalytics } from "./queries";
import { AnalyticsError } from "./shared";

const PHASE_LABEL: Record<SubscriptionPhase, string> = {
  TRIAL: "Trial",
  ACTIVE: "Active",
  GRACE: "Grace period",
  RESTRICTED: "Restricted",
  SUSPENDED: "Suspended",
  DEACTIVATED: "Deactivated",
  NONE: "No subscription",
};

const PHASE_TONE: Record<SubscriptionPhase, StatusTone> = {
  TRIAL: "info",
  ACTIVE: "success",
  GRACE: "warning",
  RESTRICTED: "danger",
  SUSPENDED: "danger",
  DEACTIVATED: "neutral",
  NONE: "neutral",
};

const PHASE_COLOR: Record<SubscriptionPhase, string> = {
  TRIAL: chartColor(0),
  ACTIVE: chartColor(1),
  GRACE: chartColor(4),
  RESTRICTED: chartColor(3),
  SUSPENDED: chartColor(2),
  DEACTIVATED: "var(--muted-foreground)",
  NONE: "var(--muted-foreground)",
};

const PHASE_ORDER: SubscriptionPhase[] = [
  "TRIAL",
  "ACTIVE",
  "GRACE",
  "RESTRICTED",
  "SUSPENDED",
  "DEACTIVATED",
  "NONE",
];

const dateFmt = new Intl.DateTimeFormat("en-IN", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** /admin — platform KPIs, subscription mix, growth, conversion and usage (aggregates only). */
export function AdminOverview() {
  const q = useAdminAnalytics();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Platform overview" description="Workspaces, subscriptions and usage" />
      {q.isPending ? (
        <PageSkeleton variant="cards" count={8} />
      ) : q.isError ? (
        <AnalyticsError error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : (
        (() => {
          const d = q.data;
          const t = d.totals;
          // Fixed phase order keeps each phase on the same color whatever the counts.
          const phases = PHASE_ORDER.map((p) => ({
            phase: p,
            count: d.phaseDistribution.find((x) => x.phase === p)?.count ?? 0,
          })).filter((p) => p.count > 0);
          return (
            <>
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <StatCard
                  label="Workspaces"
                  value={formatCount(t.workspaces)}
                  icon={<Building2 />}
                />
                <StatCard label="On trial" value={formatCount(t.trialWorkspaces)} />
                <StatCard label="Paid" value={formatCount(t.paidWorkspaces)} />
                <StatCard
                  label="Trial conversion"
                  value={formatPercent(d.trialConversion.rate)}
                  title={`${d.trialConversion.converted} of ${d.trialConversion.trialsStarted} trials became paid`}
                />
                <StatCard label="Expired trials" value={formatCount(t.expiredTrials)} />
                <StatCard label="Suspended" value={formatCount(t.suspendedWorkspaces)} />
                <StatCard
                  label="Restaurants · branches"
                  value={`${formatCount(t.restaurants)} · ${formatCount(t.branches)}`}
                  icon={<Store />}
                />
                <StatCard label="Users" value={formatCount(t.users)} icon={<Users />} />
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <ChartCard
                  title="New workspaces"
                  description="Registrations per week (Monday, UTC), last 12 weeks"
                  className="lg:col-span-2"
                >
                  <ColumnChart
                    data={d.workspaceGrowth}
                    xKey="weekStart"
                    yKey="count"
                    label="New workspaces"
                    formatValue={formatCount}
                    formatX={formatDay}
                  />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatCount(d.workspaceGrowth.at(-1)?.cumulative ?? t.workspaces)} workspaces
                    in total.
                  </p>
                </ChartCard>
                <ChartCard title="Subscription phases" description="Computed from current dates">
                  <DonutChart
                    data={phases.map((p) => ({
                      name: PHASE_LABEL[p.phase],
                      value: p.count,
                      color: PHASE_COLOR[p.phase],
                    }))}
                    formatValue={formatCount}
                    centerValue={formatCount(t.workspaces)}
                    centerLabel="workspaces"
                  />
                </ChartCard>
              </div>

              <ChartCard
                title="Platform usage"
                description={`Orders per day across all workspaces (UTC). ${formatCount(d.usage.activeBranchesLast7Days)} branches in ${formatCount(d.usage.activeWorkspacesLast7Days)} workspaces took orders in the last 7 days.`}
              >
                <TrendChart
                  data={d.usage.ordersPerDay}
                  xKey="date"
                  series={[{ key: "orders", label: "Orders", color: chartColor(2) }]}
                  formatValue={formatCount}
                  formatAxis={formatCountCompact}
                  formatX={formatDay}
                  height={220}
                />
              </ChartCard>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <ChartCard title="Plans" description="Workspaces per plan and phase">
                  <DataTable
                    aria-label="Plan distribution"
                    rows={d.planDistribution}
                    rowKey={(r) => r.planKey ?? "none"}
                    columns={[
                      {
                        id: "plan",
                        header: "Plan",
                        cell: (r) => <span className="font-medium">{r.planName}</span>,
                      },
                      {
                        id: "phases",
                        header: "Phases",
                        cell: (r) => (
                          <span className="flex flex-wrap gap-1">
                            {PHASE_ORDER.filter((p) => r.byPhase[p]).map((p) => (
                              <StatusBadge key={p} tone={PHASE_TONE[p]}>
                                {PHASE_LABEL[p]} {r.byPhase[p]}
                              </StatusBadge>
                            ))}
                          </span>
                        ),
                      },
                      {
                        id: "total",
                        header: "Total",
                        align: "right",
                        cell: (r) => formatCount(r.total),
                      },
                    ]}
                  />
                </ChartCard>
                <ChartCard title="Recent registrations" description="Last 10 workspaces">
                  <DataTable
                    aria-label="Recent registrations"
                    rows={d.recentWorkspaces}
                    rowKey="id"
                    columns={[
                      {
                        id: "name",
                        header: "Workspace",
                        cell: (w) => (
                          <Link
                            href={`/admin/workspaces/${w.id}`}
                            className="flex flex-col hover:underline"
                          >
                            <span className="font-medium">{w.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {dateFmt.format(new Date(w.createdAt))}
                              {w.planName ? ` · ${w.planName}` : ""}
                            </span>
                          </Link>
                        ),
                      },
                      {
                        id: "phase",
                        header: "Phase",
                        cell: (w) => (
                          <StatusBadge tone={PHASE_TONE[w.phase]}>
                            {PHASE_LABEL[w.phase]}
                          </StatusBadge>
                        ),
                      },
                      {
                        id: "size",
                        header: "Size",
                        align: "right",
                        cell: (w) => (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground tabular-nums">
                            <GitBranch className="size-3" aria-hidden />
                            {w.branches} · <Users className="size-3" aria-hidden />
                            {w.members}
                          </span>
                        ),
                      },
                    ]}
                  />
                </ChartCard>
              </div>
            </>
          );
        })()
      )}
    </div>
  );
}
