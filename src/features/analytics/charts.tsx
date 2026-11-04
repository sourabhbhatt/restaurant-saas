"use client";

import { useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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

const AXIS = { fontSize: 12, fill: "var(--muted-foreground)" } as const;
const GRID = "var(--border)";

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
          <CardTitle className="text-base">{title}</CardTitle>
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

// ---------------------------------------------------------------- tooltip

function TooltipBox({
  title,
  rows,
}: {
  title: ReactNode;
  rows: { label: string; value: string; color?: string }[];
}) {
  return (
    <div className="min-w-36 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <p className="mb-1 text-muted-foreground">{title}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.label} className="flex items-center gap-2">
            {r.color && (
              <span aria-hidden className="h-0.5 w-3 shrink-0" style={{ background: r.color }} />
            )}
            <span className="font-semibold tabular-nums">{r.value}</span>
            <span className="text-muted-foreground">{r.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- trend (area)

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
  const content = (p: TooltipContentProps) => {
    if (!p.active || !p.payload?.length) return null;
    const label = String(p.label ?? "");
    return (
      <TooltipBox
        title={formatX ? formatX(label) : label}
        rows={series.map((s) => {
          const entry = p.payload.find((e) => e.dataKey === s.key);
          return { label: s.label, value: formatValue(Number(entry?.value ?? 0)), color: s.color };
        })}
      />
    );
  };
  return (
    <div className="flex flex-col gap-3">
      {series.length > 1 && <Legend items={series} shape="line" />}
      <div style={{ height }} className="w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data as unknown as Record<string, unknown>[]}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          >
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis
              dataKey={xKey as string}
              tick={AXIS}
              tickLine={false}
              axisLine={{ stroke: GRID }}
              tickFormatter={formatX}
              minTickGap={24}
            />
            <YAxis
              tick={AXIS}
              tickLine={false}
              axisLine={false}
              width={64}
              tickFormatter={formatAxis ?? formatValue}
              allowDecimals={false}
            />
            <Tooltip
              content={content}
              cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
            />
            {series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.label}
                stroke={s.color}
                strokeWidth={2}
                fill={s.color}
                fillOpacity={0.1}
                dot={false}
                activeDot={{ r: 4, stroke: "var(--card)", strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- columns

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
  const content = (p: TooltipContentProps) => {
    if (!p.active || !p.payload?.length) return null;
    const label2 = String(p.label ?? "");
    return (
      <TooltipBox
        title={formatX ? formatX(label2) : label2}
        rows={[{ label, value: formatValue(Number(p.payload[0]?.value ?? 0)), color }]}
      />
    );
  };
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data as unknown as Record<string, unknown>[]}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          barCategoryGap={2}
        >
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis
            dataKey={xKey as string}
            tick={AXIS}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            tickFormatter={formatX}
            minTickGap={16}
          />
          <YAxis
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            width={56}
            tickFormatter={formatAxis ?? formatValue}
            allowDecimals={false}
          />
          <Tooltip content={content} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
          <Bar
            dataKey={yKey as string}
            name={label}
            fill={color}
            maxBarSize={24}
            radius={[4, 4, 0, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------- horizontal bars

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
  const height = Math.max(120, data.length * 36 + 24);
  const content = (p: TooltipContentProps) => {
    if (!p.active || !p.payload?.length) return null;
    const row = p.payload[0]?.payload as T | undefined;
    return (
      <TooltipBox
        title={String(row?.[nameKey] ?? "")}
        rows={[{ label, value: formatValue(Number(p.payload[0]?.value ?? 0)), color }]}
      />
    );
  };
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data as unknown as Record<string, unknown>[]}
          layout="vertical"
          margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
          barCategoryGap={8}
        >
          <CartesianGrid horizontal={false} stroke={GRID} />
          <XAxis
            type="number"
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatAxis ?? formatValue}
            allowDecimals={false}
          />
          <YAxis
            type="category"
            dataKey={nameKey as string}
            tick={AXIS}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            width={120}
            tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
          />
          <Tooltip content={content} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
          <Bar
            dataKey={valueKey as string}
            name={label}
            fill={color}
            maxBarSize={20}
            radius={[0, 4, 4, 0]}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------- donut

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
  const positive = data.filter((d) => d.value > 0);
  const total = positive.reduce((s, d) => s + d.value, 0);
  const content = (p: TooltipContentProps) => {
    if (!p.active || !p.payload?.length) return null;
    const e = p.payload[0]!;
    const share = total ? Math.round((Number(e.value) / total) * 1000) / 10 : 0;
    return (
      <TooltipBox
        title={String(e.name)}
        rows={[{ label: `${share}%`, value: formatValue(Number(e.value)) }]}
      />
    );
  };
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative size-44 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={positive}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="100%"
              stroke="var(--card)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {positive.map((d) => (
                <Cell key={d.name} fill={d.color ?? chartColor(data.indexOf(d))} />
              ))}
            </Pie>
            <Tooltip content={content} />
          </PieChart>
        </ResponsiveContainer>
        {centerValue && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="text-sm font-semibold">{centerValue}</span>
            {centerLabel && <span className="text-xs text-muted-foreground">{centerLabel}</span>}
          </div>
        )}
      </div>
      <ul className="flex w-full flex-col gap-2 text-sm">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span
              aria-hidden
              className="size-2.5 shrink-0 rounded-sm"
              style={{ background: d.color ?? chartColor(i) }}
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
      <div className="overflow-x-auto pb-1">
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
