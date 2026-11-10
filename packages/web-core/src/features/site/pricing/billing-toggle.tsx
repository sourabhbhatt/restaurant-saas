"use client";

import { cn } from "@ros/ui/utils";

import type { BillingView } from "./plan-model";

export function BillingToggle({
  value,
  onChange,
  savingHint,
}: {
  value: BillingView;
  onChange: (value: BillingView) => void;
  savingHint?: string | null;
}) {
  const options: { value: BillingView; label: string }[] = [
    { value: "monthly", label: "Monthly" },
    { value: "annual", label: "Annual" },
  ];
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        role="radiogroup"
        aria-label="Billing period"
        className="inline-flex items-center rounded-full border bg-background p-1 shadow-xs"
      >
        {options.map((o) => {
          const checked = value === o.value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => onChange(o.value)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground motion-safe:transition-colors",
                checked && "bg-primary text-primary-foreground shadow-sm",
                !checked && "hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      {savingHint && <p className="text-xs text-muted-foreground">{savingHint}</p>}
    </div>
  );
}
