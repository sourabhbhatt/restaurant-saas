import type * as React from "react";

import { cn } from "../../utils";
import { Badge, type BadgeProps } from "../../ui/badge";

type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

type BadgeVariant = NonNullable<BadgeProps["variant"]>;

/** Single source of truth for how a semantic tone is rendered. */
const statusToneToBadgeVariant = {
  neutral: "secondary",
  info: "info",
  success: "success",
  warning: "warning",
  danger: "destructive",
} as const satisfies Record<StatusTone, BadgeVariant>;

const dotClass: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
};

type StatusBadgeProps = Omit<BadgeProps, "variant"> & {
  tone: StatusTone;
  /** Show a leading colored dot (useful when color alone is used in dense lists). */
  dot?: boolean;
  /** Animate the dot, e.g. for "live" / "cooking" states. Respects reduced motion. */
  pulse?: boolean;
  children: React.ReactNode;
};

/**
 * Domain-agnostic status pill. Map domain states to a tone in feature code, e.g.
 * `{ pending: "warning", preparing: "info", ready: "success", cancelled: "danger" }`.
 */
function StatusBadge({
  tone,
  dot = false,
  pulse = false,
  className,
  children,
  ...props
}: StatusBadgeProps) {
  return (
    <Badge
      data-tone={tone}
      variant={statusToneToBadgeVariant[tone]}
      className={cn(dot && "gap-1.5", className)}
      {...props}
    >
      {dot && (
        <span aria-hidden="true" className="relative flex size-1.5">
          {pulse && (
            <span
              className={cn(
                "absolute inline-flex size-full rounded-full opacity-75 motion-safe:animate-ping",
                dotClass[tone],
              )}
            />
          )}
          <span className={cn("relative inline-flex size-1.5 rounded-full", dotClass[tone])} />
        </span>
      )}
      {children}
    </Badge>
  );
}

export { StatusBadge, statusToneToBadgeVariant };
export type { StatusBadgeProps, StatusTone };
