"use client";

import { MinusIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { cn } from "@/lib/utils";

interface QuantityStepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  /** Label of the thing being counted, for screen readers. */
  label: string;
  /** Show a remove (trash) icon instead of minus at the minimum (cart lines). */
  removable?: boolean;
  size?: "default" | "lg";
  className?: string;
}

/** − n + control with 44px touch targets. */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 99,
  label,
  removable = false,
  size = "default",
  className,
}: QuantityStepperProps) {
  const atMin = value <= min;
  const btn =
    "inline-flex size-11 items-center justify-center rounded-full text-foreground outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-40 motion-safe:transition-colors";
  return (
    <div
      role="group"
      aria-label={`Quantity of ${label}`}
      className={cn(
        "inline-flex items-center rounded-full border bg-background",
        size === "lg" && "text-base",
        className,
      )}
    >
      <button
        type="button"
        className={btn}
        onClick={() => onChange(value - 1)}
        disabled={atMin && !removable}
        aria-label={atMin && removable ? `Remove ${label}` : `Decrease quantity of ${label}`}
      >
        {atMin && removable ? (
          <Trash2Icon className="size-4 text-destructive" />
        ) : (
          <MinusIcon className="size-4" />
        )}
      </button>
      <span className="min-w-8 text-center font-semibold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        className={btn}
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label={`Increase quantity of ${label}`}
      >
        <PlusIcon className="size-4" />
      </button>
    </div>
  );
}
