"use client";

import type { ReactNode } from "react";
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

/**
 * The Recharts plots behind the chart components in ./charts. Recharts is
 * about 115 KB gzip, so this module is its own chunk, loaded lazily. Each plot
 * fills the box its chart component has already sized, so nothing moves when
 * the chunk arrives.
 */

const AXIS = { fontSize: 12, fill: "var(--muted-foreground)" } as const;
const GRID = "var(--border)";

type Row = Record<string, unknown>;

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

export interface TrendPlotProps {
  data: Row[];
  xKey: string;
  series: { key: string; label: string; color: string }[];
  formatValue: (v: number) => string;
  formatAxis?: (v: number) => string;
  formatX?: (v: string) => string;
}

export function TrendPlot({
  data,
  xKey,
  series,
  formatValue,
  formatAxis,
  formatX,
}: TrendPlotProps) {
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
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis
          dataKey={xKey}
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
        <Tooltip content={content} cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }} />
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
  );
}

export interface ColumnPlotProps {
  data: Row[];
  xKey: string;
  yKey: string;
  label: string;
  color: string;
  formatValue: (v: number) => string;
  formatAxis?: (v: number) => string;
  formatX?: (v: string) => string;
}

export function ColumnPlot({
  data,
  xKey,
  yKey,
  label,
  color,
  formatValue,
  formatAxis,
  formatX,
}: ColumnPlotProps) {
  const content = (p: TooltipContentProps) => {
    if (!p.active || !p.payload?.length) return null;
    const x = String(p.label ?? "");
    return (
      <TooltipBox
        title={formatX ? formatX(x) : x}
        rows={[{ label, value: formatValue(Number(p.payload[0]?.value ?? 0)), color }]}
      />
    );
  };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis
          dataKey={xKey}
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
          dataKey={yKey}
          name={label}
          fill={color}
          maxBarSize={24}
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface BarPlotProps {
  data: Row[];
  nameKey: string;
  valueKey: string;
  label: string;
  color: string;
  formatValue: (v: number) => string;
  formatAxis?: (v: number) => string;
}

export function BarPlot({
  data,
  nameKey,
  valueKey,
  label,
  color,
  formatValue,
  formatAxis,
}: BarPlotProps) {
  const content = (p: TooltipContentProps) => {
    if (!p.active || !p.payload?.length) return null;
    const row = p.payload[0]?.payload as Row | undefined;
    return (
      <TooltipBox
        title={String(row?.[nameKey] ?? "")}
        rows={[{ label, value: formatValue(Number(p.payload[0]?.value ?? 0)), color }]}
      />
    );
  };
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
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
          dataKey={nameKey}
          tick={AXIS}
          tickLine={false}
          axisLine={{ stroke: GRID }}
          width={120}
          tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)}
        />
        <Tooltip content={content} cursor={{ fill: "var(--muted)", opacity: 0.5 }} />
        <Bar
          dataKey={valueKey}
          name={label}
          fill={color}
          maxBarSize={20}
          radius={[0, 4, 4, 0]}
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface DonutPlotProps {
  /** Slices with a value above zero, colors already resolved. */
  slices: { name: string; value: number; color: string }[];
  formatValue: (v: number) => string;
}

export function DonutPlot({ slices, formatValue }: DonutPlotProps) {
  const total = slices.reduce((s, d) => s + d.value, 0);
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
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={slices}
          dataKey="value"
          nameKey="name"
          innerRadius="62%"
          outerRadius="100%"
          stroke="var(--card)"
          strokeWidth={2}
          isAnimationActive={false}
        >
          {slices.map((d) => (
            <Cell key={d.name} fill={d.color} />
          ))}
        </Pie>
        <Tooltip content={content} />
      </PieChart>
    </ResponsiveContainer>
  );
}
