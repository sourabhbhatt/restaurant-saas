"use client";

import { Component, lazy, Suspense, useState, type ReactNode } from "react";

import { Button } from "@ros/ui/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@ros/ui/ui/card";
import { Skeleton } from "@ros/ui/ui/skeleton";
import { cn } from "@ros/ui/utils";

import { formatHour, WEEKDAYS } from "./format";

/**
 * Chart primitives on the design tokens. Categorical slots are assigned in a
 * fixed order (never by rank); --chart-4 (light amber) is used last because
 * it has the lowest contrast against the card surface. Text always uses text
 * tokens — the colored mark beside it carries identity.
 */
const SLOT_ORDER = [1, 2, 3, 5, 4] as const;
export function chartColor(index: number): string {
  return `var(--chart-${SLOT_ORDER[index % SLOT_ORDER.length]})`;
}

/** Payment methods keep their color whatever their rank. */
const METHOD_SLOT: Record<string, number> = { CASH: 0, UPI: 1, CARD: 2, OTHER: 3 };
export function methodColor(method: string): string {
  return chartColor(METHOD_SLOT[method] ?? 4);
}

// ---------------------------------------------------------------- card shell

export function ChartCard({
  title,
  description,
  action,
  children,
  className,
  loading,
  dimmed,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  loading?: boolean;
  /** Refetching: keep the previous render, at reduced opacity. */
  dimmed?: boolean;
}) {
  return (
    <Card className={cn("gap-4", className)}>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <CardTitle className="text-base">
            <h2>{title}</h2>
          </CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent
        className={cn("min-w-0 motion-safe:transition-opacity", dimmed && "opacity-60")}
        aria-busy={loading || dimmed || undefined}
      >
        {loading ? <Skeleton className="h-56 w-full" /> : children}
      </CardContent>
    </Card>
  );
}

export function Legend({
  items,
  shape = "rect",
}: {
  items: { label: string; color: string }[];
  shape?: "rect" | "line";
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn("inline-block", shape === "line" ? "h-0.5 w-3" : "size-2.5 rounded-sm")}
            style={{ background: i.color }}
          />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- recharts plots (lazy)

/*
 * Recharts is about 115 KB gzip. The plots live in charts-recharts.tsx, a chunk
 * requested as soon as this module runs in the browser, so it downloads
 * alongside the report data instead of blocking first paint. Each chart below
 * sizes its box (and legend) itself and only the plot inside is lazy, so the
 * page never shifts when the chunk arrives.
 */
const loadPlots = () => import("./charts-recharts");
// Warm-up only: a failure here surfaces (once) in the chart's own boundary below.
if (typeof window !== "undefined") void loadPlots().catch(() => undefined);

const TrendPlot = lazy(() => loadPlots().then((m) => ({ default: m.TrendPlot })));
const ColumnPlot = lazy(() => loadPlots().then((m) => ({ default: m.ColumnPlot })));
const BarPlot = lazy(() => loadPlots().then((m) => ({ default: m.BarPlot })));
const DonutPlot = lazy(() => loadPlots().then((m) => ({ default: m.DonutPlot })));

/**
 * If the plots chunk cannot be fetched, only the chart says so; the report
 * around it stays usable. React.lazy keeps a failed import, so "Reload" reloads
 * the page.
 */
class PlotErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="status"
        className="flex size-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-3 text-center text-sm text-muted-foreground"
      >
        <span>Chart unavailable</span>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    );
  }
}

function PlotBox({ height, children }: { height: number; children: ReactNode }) {
  return (
    <div style={{ height }} className="w-full">
      <PlotErrorBoundary>
        <Suspense fallback={<Skeleton className="size-full" />}>{children}</Suspense>
      </PlotErrorBoundary>
    </div>
  );
}

type Rows = Record<string, unknown>[];

export interface SeriesDef {
  key: string;
  label: string;
  color: string;
}

export function TrendChart<T extends object>({
  data,
  xKey,
  series,
  formatValue,
  formatAxis,
  formatX,
  height = 260,
}: {
  data: T[];
  xKey: keyof T & string;
  series: SeriesDef[];
  formatValue: (v: number) => string;
  formatAxis?: (v: number) => string;
  formatX?: (v: string) => string;
  height?: number;
}) {
  return (
    <div className="flex flex-col gap-3">
      {series.length > 1 && <Legend items={series} shape="line" />}
      <PlotBox height={height}>
        <TrendPlot
          data={data as unknown as Rows}
          xKey={xKey}
          series={series}
          formatValue={formatValue}
          formatAxis={formatAxis}
          formatX={formatX}
        />
      </PlotBox>
    </div>
  );
}

export function ColumnChart<T extends object>({
  data,
  xKey,
  yKey,
  label,
  color = chartColor(0),
  formatValue,
  formatAxis,
  formatX,
  height = 240,
}: {
  data: T[];
  xKey: keyof T & string;
  yKey: keyof T & string;
  label: string;
  color?: string;
  formatValue: (v: number) => string;
  formatAxis?: (v: number) => string;
  formatX?: (v: string) => string;
  height?: number;
}) {
  return (
    <PlotBox height={height}>
      <ColumnPlot
        data={data as unknown as Rows}
        xKey={xKey}
        yKey={yKey}
        label={label}
        color={color}
        formatValue={formatValue}
        formatAxis={formatAxis}
        formatX={formatX}
      />
    </PlotBox>
  );
}

export function BarList<T extends object>({
  data,
  nameKey,
  valueKey,
  label,
  color = chartColor(0),
  formatValue,
  formatAxis,
}: {
  data: T[];
  nameKey: keyof T & string;
  valueKey: keyof T & string;
  label: string;
  color?: string;
  formatValue: (v: number) => string;
  formatAxis?: (v: number) => string;
}) {
  return (
    <PlotBox height={Math.max(120, data.length * 36 + 24)}>
      <BarPlot
        data={data as unknown as Rows}
        nameKey={nameKey}
        valueKey={valueKey}
        label={label}
        color={color}
        formatValue={formatValue}
        formatAxis={formatAxis}
      />
    </PlotBox>
  );
}

export function DonutChart({
  data,
  formatValue,
  centerLabel,
  centerValue,
}: {
  /** `color` pins a slot to the entity; otherwise slots follow list order. */
  data: { name: string; value: number; color?: string }[];
  formatValue: (v: number) => string;
  centerLabel?: string;
  centerValue?: string;
}) {
  const colored = data.map((d, i) => ({ ...d, color: d.color ?? chartColor(i) }));
  const slices = colored.filter((d) => d.value > 0);
  const total = slices.reduce((s, d) => s + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative size-44 shrink-0">
        <PlotErrorBoundary>
          <Suspense fallback={<Skeleton className="size-full rounded-full" />}>
            <DonutPlot slices={slices} formatValue={formatValue} />
          </Suspense>
        </PlotErrorBoundary>
        {centerValue && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-sm font-semibold">{centerValue}</span>
            {centerLabel && <span className="text-xs text-muted-foreground">{centerLabel}</span>}
          </div>
        )}
      </div>
      <ul className="flex w-full flex-col gap-2 text-sm">
        {colored.map((d) => (
          <li key={d.name} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: d.color }}
            />
            <span className="flex-1 truncate">{d.name}</span>
            <span className="font-medium tabular-nums">{formatValue(d.value)}</span>
            <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">
              {total && d.value > 0 ? `${Math.round((d.value / total) * 100)}%` : "—"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- heatmap

/**
 * Weekday × hour grid (custom divs). Sequential encoding: one hue, from the
 * surface to full --chart-1 by share of the busiest cell. Hover shows the
 * cell; the busiest slots are also listed as text.
 */
export function PeakHoursHeatmap({
  cells,
}: {
  cells: { weekday: number; hour: number; orders: number }[];
}) {
  const [hover, setHover] = useState<{ weekday: number; hour: number; orders: number } | null>(
    null,
  );
  const grid = new Map(cells.map((c) => [`${c.weekday}:${c.hour}`, c.orders]));
  const max = Math.max(0, ...cells.map((c) => c.orders));
  const top = [...cells]
    .filter((c) => c.orders > 0)
    .sort((a, b) => b.orders - a.orders)
    .slice(0, 3);
  // Monday-first rows.
  const rows = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="flex flex-col gap-3">
      <p className="min-h-5 text-xs text-muted-foreground" aria-live="polite">
        {hover ? (
          <>
            <span className="font-semibold text-foreground">{hover.orders} orders</span>{" "}
            {WEEKDAYS[hover.weekday]} {formatHour(hover.hour)}–{formatHour((hover.hour + 1) % 24)}
          </>
        ) : top.length ? (
          <>
            Busiest:{" "}
            {top
              .map((c) => `${WEEKDAYS[c.weekday]} ${formatHour(c.hour)} (${c.orders})`)
              .join(", ")}
          </>
        ) : (
          "No orders in this period"
        )}
      </p>
      {/* Scrolls sideways on phones: focusable so keyboard users can scroll it. */}
      <div
        className="overflow-x-auto rounded-md pb-1 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        tabIndex={0}
      >
        <div
          className="grid min-w-[560px] gap-0.5"
          style={{ gridTemplateColumns: "2.5rem repeat(24, minmax(0, 1fr))" }}
          role="img"
          aria-label={`Orders by weekday and hour. ${top.length ? `Busiest: ${top.map((c) => `${WEEKDAYS[c.weekday]} ${formatHour(c.hour)}, ${c.orders} orders`).join("; ")}` : "No orders."}`}
          onMouseLeave={() => setHover(null)}
        >
          {rows.map((wd) => (
            <div key={wd} className="contents">
              <div className="flex items-center text-xs text-muted-foreground">{WEEKDAYS[wd]}</div>
              {Array.from({ length: 24 }, (_, h) => {
                const n = grid.get(`${wd}:${h}`) ?? 0;
                const pct = max ? Math.round((n / max) * 85) + 15 : 0;
                return (
                  <div
                    key={h}
                    onMouseEnter={() => setHover({ weekday: wd, hour: h, orders: n })}
                    title={`${WEEKDAYS[wd]} ${formatHour(h)}: ${n} orders`}
                    className={cn(
                      "h-6 rounded-[3px] hover:outline-2 hover:outline-offset-1 hover:outline-foreground/40",
                      n === 0 && "bg-muted",
                    )}
                    style={
                      n > 0
                        ? { background: `color-mix(in oklch, var(--chart-1) ${pct}%, var(--card))` }
                        : undefined
                    }
                  />
                );
              })}
            </div>
          ))}
          <div />
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} className="pt-1 text-center text-[10px] text-muted-foreground">
              {h % 3 === 0 ? formatHour(h) : ""}
            </div>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>Fewer</span>
        {[15, 36, 57, 78, 100].map((p) => (
          <span
            key={p}
            aria-hidden
            className="h-2.5 w-5 rounded-[3px]"
            style={{ background: `color-mix(in oklch, var(--chart-1) ${p}%, var(--card))` }}
          />
        ))}
        <span>More</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- meter

export function Meter({ value, label }: { value: number | null; label: string }) {
  const v = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-primary/15"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value ?? 0}
    >
      <div className="h-full rounded-full bg-primary" style={{ width: `${v}%` }} />
    </div>
  );
}
