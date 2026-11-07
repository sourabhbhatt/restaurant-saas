"use client";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { defaultBusinessHours, type BusinessHoursDayDto } from "@ros/contracts/tenancy";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Fill missing days with defaults and order Sunday→Saturday. */
type HoursInput =
  readonly { day: number; closed: boolean; open: string; close: string }[] | undefined;

export function normaliseHours(hours: HoursInput): BusinessHoursDayDto[] {
  const byDay = new Map(
    (hours ?? []).map((h) => [h.day, { ...h, day: h.day as BusinessHoursDayDto["day"] }]),
  );
  return defaultBusinessHours().map((d) => byDay.get(d.day) ?? d);
}

export function BusinessHoursEditor({
  value,
  onChange,
  errors,
  disabled,
}: {
  value: HoursInput;
  onChange: (next: BusinessHoursDayDto[]) => void;
  errors?: Record<number, string | undefined>;
  disabled?: boolean;
}) {
  const hours = normaliseHours(value);
  const update = (day: number, patch: Partial<BusinessHoursDayDto>) =>
    onChange(hours.map((h) => (h.day === day ? { ...h, ...patch } : h)));
  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Business hours">
      {hours.map((h) => (
        <div key={h.day} className="flex flex-wrap items-center gap-3">
          <span className="w-24 text-sm font-medium">{DAYS[h.day]}</span>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={!h.closed}
              onCheckedChange={(open) => update(h.day, { closed: !open })}
              disabled={disabled}
              aria-label={`${DAYS[h.day]} open`}
            />
            {h.closed ? "Closed" : "Open"}
          </label>
          {!h.closed && (
            <>
              <Input
                type="time"
                className="w-32"
                value={h.open}
                disabled={disabled}
                aria-label={`${DAYS[h.day]} opens`}
                onChange={(e) => update(h.day, { open: e.target.value })}
              />
              <span className="text-sm text-muted-foreground">to</span>
              <Input
                type="time"
                className="w-32"
                value={h.close}
                disabled={disabled}
                aria-label={`${DAYS[h.day]} closes`}
                onChange={(e) => update(h.day, { close: e.target.value })}
              />
            </>
          )}
          {errors?.[h.day] ? (
            <p className="w-full text-xs text-destructive">{errors[h.day]}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
