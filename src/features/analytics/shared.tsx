"use client";

import { BarChart3, Lock, Sparkles } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { EmptyState, ErrorState, StatCard } from "@/components/shared/feedback";
import { Button } from "@/components/ui/button";
import type { SalesDeltasDto, SalesKpisDto } from "@ros/contracts/analytics";
import { ApiError, errorMessage } from "@/lib/api-client";

import { deltaLabel, formatCount, formatMoney } from "./format";

/** Error view that explains plan and permission errors instead of offering a pointless retry. */
export function AnalyticsError({
  error,
  onRetry,
  retrying,
  upgradeHref,
}: {
  error: unknown;
  onRetry: () => void;
  retrying?: boolean;
  upgradeHref?: string;
}) {
  if (error instanceof ApiError && error.status === 402) {
    return (
      <EmptyState
        icon={<Sparkles />}
        title="Analytics isn't included in your plan"
        description={error.message}
        action={
          upgradeHref ? (
            <Button asChild>
              <Link href={upgradeHref}>View plans</Link>
            </Button>
          ) : undefined
        }
      />
    );
  }
  if (error instanceof ApiError && error.status === 403) {
    return (
      <EmptyState
        icon={<Lock />}
        title="You don't have access to these reports"
        description={
          error.code === "WORKSPACE_RESTRICTED"
            ? error.message
            : "Ask a workspace owner or manager for report access."
        }
      />
    );
  }
  return (
    <ErrorState
      title="Couldn't load analytics"
      message={errorMessage(error)}
      onRetry={onRetry}
      retrying={retrying}
    />
  );
}

export function NoOrders({ action }: { action?: ReactNode }) {
  return (
    <EmptyState
      size="compact"
      icon={<BarChart3 />}
      title="No orders in this period"
      description="Try a longer period or another branch."
      action={action}
    />
  );
}

export function KpiGrid({
  kpis,
  deltas,
  currency,
  days,
  pendingNow,
  loading,
}: {
  kpis?: SalesKpisDto;
  deltas?: SalesDeltasDto;
  currency: string;
  days: number;
  pendingNow?: number;
  loading?: boolean;
}) {
  const label = deltaLabel(days);
  const d = (key: keyof SalesKpisDto) => deltas?.[key] ?? undefined;
  const money = (n: number | undefined) => (n === undefined ? "—" : formatMoney(n, currency));
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
      <StatCard
        label="Collected"
        value={money(kpis?.collected)}
        delta={d("collected")}
        deltaLabel={label}
        loading={loading}
        title="Confirmed payments minus refunds recorded in the period"
      />
      <StatCard
        label="Billed"
        value={money(kpis?.billed)}
        delta={d("billed")}
        deltaLabel={label}
        loading={loading}
        title="Grand total of non-void bills issued in the period"
      />
      <StatCard
        label="Orders"
        value={kpis ? formatCount(kpis.totalOrders) : "—"}
        delta={d("totalOrders")}
        deltaLabel={label}
        loading={loading}
      />
      <StatCard
        label="Avg order value"
        value={money(kpis?.averageOrderValue)}
        delta={d("averageOrderValue")}
        deltaLabel={label}
        loading={loading}
        title="Order value of accepted orders divided by their count (before tax)"
      />
      <StatCard
        label="Completed"
        value={kpis ? formatCount(kpis.completedOrders) : "—"}
        delta={d("completedOrders")}
        deltaLabel={label}
        loading={loading}
      />
      <StatCard
        label="Cancelled & rejected"
        value={kpis ? formatCount(kpis.cancelledOrders) : "—"}
        delta={d("cancelledOrders")}
        deltaLabel={label}
        invertDelta
        loading={loading}
      />
      <StatCard
        label="Order value"
        value={money(kpis?.orderValue)}
        delta={d("orderValue")}
        deltaLabel={label}
        loading={loading}
        title="Subtotal of orders that were not rejected or cancelled"
      />
      <StatCard
        label="Pending now"
        value={pendingNow === undefined ? "—" : formatCount(pendingNow)}
        loading={loading}
        title="Orders waiting for a waiter to accept them right now"
      />
    </div>
  );
}

export function DefinitionsNote() {
  return (
    <p className="text-xs text-muted-foreground">
      <strong className="font-medium text-foreground">Collected</strong> is confirmed payments minus
      refunds recorded in the period.{" "}
      <strong className="font-medium text-foreground">Billed</strong> is the grand total of non-void
      bills issued in the period. Order value and average order value exclude rejected and cancelled
      orders and are before tax. Dates are in each branch&apos;s local time.
    </p>
  );
}
