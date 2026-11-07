import type * as React from "react";
import { MinusIcon, TrendingDownIcon, TrendingUpIcon } from "lucide-react";

import { cn } from "../../utils";
import { Card } from "../../ui/card";
import { Skeleton } from "../../ui/skeleton";

type StatCardProps = Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode;
  /** Pre-formatted value, e.g. "$12,480" or "38". */
  value: React.ReactNode;
  /** Percentage change, e.g. 12.5 for +12.5%. */
  delta?: number;
  /** Context for the delta, e.g. "vs last week". */
  deltaLabel?: string;
  /** For metrics where lower is better (wait time, refunds): a drop is shown as positive. */
  invertDelta?: boolean;
  icon?: React.ReactNode;
  loading?: boolean;
};

function formatDelta(delta: number): string {
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return `${sign}${Math.abs(delta).toFixed(1)}%`;
}

function StatCard({
  label,
  value,
  delta,
  deltaLabel,
  invertDelta = false,
  icon,
  loading = false,
  className,
  ...props
}: StatCardProps) {
  const direction = delta == null || delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  const isGood = direction === "flat" ? null : (direction === "up") !== invertDelta;
  const TrendIcon =
    direction === "up" ? TrendingUpIcon : direction === "down" ? TrendingDownIcon : MinusIcon;

  return (
    <Card
      data-slot="stat-card"
      aria-busy={loading || undefined}
      className={cn("gap-3 px-5 py-5", className)}
      {...props}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        {icon && (
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary [&_svg:not([class*='size-'])]:size-4"
          >
            {icon}
          </span>
        )}
      </div>
      {loading ? (
        <div className="flex flex-col gap-2">
          <span className="sr-only">Loading</span>
          <Skeleton className="h-8 w-24" />
          <Skeleton className="h-4 w-32" />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <p data-numeric className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {value}
          </p>
          {delta != null && (
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span
                data-trend={direction}
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-medium",
                  isGood === true && "bg-success/10 text-success",
                  isGood === false && "bg-destructive/10 text-destructive",
                  isGood === null && "bg-muted text-muted-foreground",
                )}
              >
                <TrendIcon aria-hidden="true" className="size-3" />
                {formatDelta(delta)}
              </span>
              {deltaLabel && <span>{deltaLabel}</span>}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

export { StatCard };
export type { StatCardProps };
