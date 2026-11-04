"use client";

import { CheckIcon, CircleIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Live hints that mirror the shared `passwordSchema` rules (10+ chars, a letter
 * and a number), plus optional extras that make a password stronger.
 */
export function passwordChecks(value: string) {
  return [
    { label: "At least 10 characters", ok: value.length >= 10, required: true },
    { label: "A letter and a number", ok: /[A-Za-z]/.test(value) && /[0-9]/.test(value), required: true },
    { label: "Upper and lower case", ok: /[a-z]/.test(value) && /[A-Z]/.test(value), required: false },
    { label: "A symbol", ok: /[^A-Za-z0-9]/.test(value), required: false },
  ];
}

export function passwordScore(value: string): 0 | 1 | 2 | 3 | 4 {
  if (!value) return 0;
  const checks = passwordChecks(value);
  const required = checks.filter((c) => c.required).every((c) => c.ok);
  if (!required) return 1;
  const extras = checks.filter((c) => !c.required && c.ok).length + (value.length >= 14 ? 1 : 0);
  return extras >= 2 ? 4 : extras === 1 ? 3 : 2;
}

const LABELS = ["", "Too weak", "Okay", "Good", "Strong"] as const;
const BAR = ["", "bg-destructive", "bg-warning", "bg-success/70", "bg-success"] as const;

export function PasswordStrength({ value, id }: { value: string; id?: string }) {
  const score = passwordScore(value);
  const checks = passwordChecks(value);
  return (
    <div id={id} className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden="true">
          {[1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className={cn(
                "h-1 rounded-full bg-muted motion-safe:transition-colors",
                score >= i && BAR[score],
              )}
            />
          ))}
        </div>
        <span className="w-16 text-right text-xs text-muted-foreground" aria-live="polite">
          {value ? LABELS[score] : ""}
        </span>
      </div>
      <ul className="grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
        {checks.map((c) => (
          <li
            key={c.label}
            className={cn("flex items-center gap-1.5 text-muted-foreground", c.ok && "text-success")}
          >
            {c.ok ? (
              <CheckIcon aria-hidden="true" className="size-3.5" />
            ) : (
              <CircleIcon aria-hidden="true" className="size-3" />
            )}
            {c.label}
            {!c.required && <span className="text-muted-foreground/70">(optional)</span>}
            <span className="sr-only">{c.ok ? "— done" : "— not yet"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
