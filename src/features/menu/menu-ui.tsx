"use client";

import { useState, type ComponentProps } from "react";

import { Input } from "@/components/ui/input";
import { DIETARY_LABELS } from "@ros/contracts/menu";
import type { DietaryType } from "@ros/domain/menu/pricing";
import { toMajor, toMinor, isCurrencyCode } from "@ros/domain/shared/money";
import { cn } from "@/lib/utils";

const DIETARY_STYLE: Record<DietaryType, string> = {
  VEG: "border-success text-success",
  VEGAN: "border-success text-success",
  EGG: "border-warning text-warning",
  NON_VEG: "border-destructive text-destructive",
};

/** The familiar square veg / non-veg mark, with an accessible label. */
export function DietaryMark({ dietary, className }: { dietary: DietaryType; className?: string }) {
  return (
    <span
      role="img"
      aria-label={DIETARY_LABELS[dietary]}
      title={DIETARY_LABELS[dietary]}
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] border-2",
        DIETARY_STYLE[dietary],
        className,
      )}
    >
      <span
        className={cn(
          "block size-1.5 bg-current",
          dietary === "NON_VEG" ? "[clip-path:polygon(50%_0,100%_100%,0_100%)]" : "rounded-full",
        )}
      />
    </span>
  );
}

function toText(minor: number | null | undefined, currency: string): string {
  if (minor === null || minor === undefined || Number.isNaN(minor)) return "";
  const code = isCurrencyCode(currency) ? currency : "INR";
  return String(toMajor(minor, code));
}

/**
 * Money input: shows major units ("320.50"), reports integer minor units.
 * Empty reports `null` (or NaN when `required`, so the schema flags it).
 */
export function MoneyInput({
  value,
  onChange,
  currency,
  required = false,
  placeholder,
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: number | null | undefined;
  onChange: (minor: number | null) => void;
  currency: string;
  required?: boolean;
}) {
  const [text, setText] = useState(() => toText(value, currency));
  const [lastValue, setLastValue] = useState(value);
  // Follow external resets (form.reset) without fighting the user's typing.
  if (!Object.is(value, lastValue)) {
    setLastValue(value);
    const parsed = text.trim() === "" ? null : Number(text);
    const asMinor =
      parsed === null || Number.isNaN(parsed)
        ? null
        : toMinor(parsed, isCurrencyCode(currency) ? currency : "INR");
    if (!Object.is(asMinor, value ?? null) && !Number.isNaN(value))
      setText(toText(value, currency));
  }
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground">
        {currency}
      </span>
      <Input
        {...props}
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder ?? "0.00"}
        className={cn("pl-12 tabular-nums", props.className)}
        value={text}
        onChange={(e) => {
          const next = e.target.value.replace(/[^\d.]/g, "");
          setText(next);
          if (next.trim() === "") {
            onChange(required ? Number.NaN : null);
            return;
          }
          const n = Number(next);
          onChange(
            Number.isNaN(n) ? Number.NaN : toMinor(n, isCurrencyCode(currency) ? currency : "INR"),
          );
        }}
      />
    </div>
  );
}
