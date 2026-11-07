"use client";

import { CalendarRange } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  addDaysIso,
  daysInclusive,
  localDate,
  MAX_RANGE_DAYS,
} from "@ros/domain/analytics/date-range";
import { cn } from "@/lib/utils";

import { formatRange } from "./format";

export type RangePreset = "today" | "7d" | "30d" | "90d" | "custom";

export interface RangeState {
  preset: RangePreset;
  from: string;
  to: string;
}

const PRESETS: { value: Exclude<RangePreset, "custom">; label: string; days: number }[] = [
  { value: "today", label: "Today", days: 1 },
  { value: "7d", label: "7 days", days: 7 },
  { value: "30d", label: "30 days", days: 30 },
  { value: "90d", label: "90 days", days: 90 },
];

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Today's date in the given time zone (the branch's, or the browser's). */
export function todayIn(timeZone?: string): string {
  return localDate(new Date(), timeZone ?? browserZone());
}

export function rangeForPreset(
  preset: Exclude<RangePreset, "custom">,
  timeZone?: string,
): RangeState {
  const to = todayIn(timeZone);
  const days = PRESETS.find((p) => p.value === preset)!.days;
  return { preset, from: addDaysIso(to, -(days - 1)), to };
}

export function useDateRange(timeZone?: string, initial: Exclude<RangePreset, "custom"> = "7d") {
  return useState<RangeState>(() => rangeForPreset(initial, timeZone));
}

function validate(from: string, to: string, today: string): { from?: string; to?: string } {
  const errors: { from?: string; to?: string } = {};
  if (!from) errors.from = "Choose a start date";
  if (!to) errors.to = "Choose an end date";
  if (errors.from || errors.to) return errors;
  if (from > to) errors.from = "Must be on or before the end date";
  else if (daysInclusive(from, to) > MAX_RANGE_DAYS) errors.to = `At most ${MAX_RANGE_DAYS} days`;
  else if (from > today) errors.from = "Can't be in the future";
  return errors;
}

export interface DateRangeFilterProps {
  value: RangeState;
  onChange: (value: RangeState) => void;
  /** IANA zone used to compute "today" for the presets. */
  timeZone?: string;
  className?: string;
}

/**
 * Period picker: presets (Today / 7 / 30 / 90 days) plus a custom range with
 * native date inputs. A custom range is applied as soon as both dates are
 * valid; invalid input is highlighted with a message and never sent.
 */
export function DateRangeFilter({ value, onChange, timeZone, className }: DateRangeFilterProps) {
  const id = useId();
  const today = todayIn(timeZone);
  const [draft, setDraft] = useState({ from: value.from, to: value.to });
  const errors = useMemo(() => validate(draft.from, draft.to, today), [draft, today]);

  function choose(preset: string) {
    if (!preset) return;
    if (preset === "custom") {
      setDraft({ from: value.from, to: value.to });
      onChange({ ...value, preset: "custom" });
      return;
    }
    const next = rangeForPreset(preset as Exclude<RangePreset, "custom">, timeZone);
    setDraft({ from: next.from, to: next.to });
    onChange(next);
  }

  function edit(field: "from" | "to", v: string) {
    const next = { ...draft, [field]: v };
    setDraft(next);
    const e = validate(next.from, next.to, today);
    if (!e.from && !e.to) onChange({ preset: "custom", from: next.from, to: next.to });
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={value.preset}
          onValueChange={choose}
          aria-label="Reporting period"
          className="max-w-full overflow-x-auto"
        >
          {PRESETS.map((p) => (
            <ToggleGroupItem key={p.value} value={p.value} className="px-3">
              {p.label}
            </ToggleGroupItem>
          ))}
          <ToggleGroupItem value="custom" className="px-3">
            <CalendarRange aria-hidden /> Custom
          </ToggleGroupItem>
        </ToggleGroup>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {formatRange(value.from, value.to)}
        </p>
      </div>
      {value.preset === "custom" && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          {(["from", "to"] as const).map((field) => (
            <div key={field} className="flex flex-col gap-1.5">
              <Label htmlFor={`${id}-${field}`}>{field === "from" ? "From" : "To"}</Label>
              <Input
                id={`${id}-${field}`}
                type="date"
                value={draft[field]}
                max={today}
                onChange={(e) => edit(field, e.target.value)}
                aria-invalid={errors[field] ? true : undefined}
                aria-describedby={errors[field] ? `${id}-${field}-error` : undefined}
                className="w-full sm:w-44"
              />
              {errors[field] && (
                <p id={`${id}-${field}-error`} className="text-xs text-destructive">
                  {errors[field]}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
