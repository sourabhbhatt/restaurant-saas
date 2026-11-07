"use client";

import * as React from "react";

import { cn } from "../../utils";

type GatedActionControlProps = {
  disabled: boolean;
  "aria-describedby": string | undefined;
};

type GatedActionProps = {
  /**
   * Why the action can't be used right now. When set, the control is disabled
   * and the reason is shown as visible text under it (hover tooltips don't
   * exist on touch screens), linked with `aria-describedby`.
   */
  reason?: React.ReactNode;
  /** Extra condition that disables the control without a reason (e.g. pending). */
  disabled?: boolean;
  /** Align the control and its reason; `end` suits page header actions. */
  align?: "start" | "end";
  className?: string;
  children: (props: GatedActionControlProps) => React.ReactNode;
};

/** A button (or any control) that shows the reason it's disabled right next to it. */
function GatedAction({ reason, disabled, align = "start", className, children }: GatedActionProps) {
  const id = React.useId();
  const blocked = reason != null && reason !== false && reason !== "";
  const reasonId = `${id}-reason`;
  return (
    <div
      data-slot="gated-action"
      className={cn(
        "flex flex-col gap-1",
        align === "end" ? "items-stretch sm:items-end" : "items-start",
        className,
      )}
    >
      {children({
        disabled: blocked || Boolean(disabled),
        "aria-describedby": blocked ? reasonId : undefined,
      })}
      {blocked && (
        <p
          id={reasonId}
          data-slot="gated-action-reason"
          className={cn(
            "max-w-xs text-xs text-muted-foreground",
            align === "end" && "sm:text-right",
          )}
        >
          {reason}
        </p>
      )}
    </div>
  );
}

export { GatedAction };
export type { GatedActionControlProps, GatedActionProps };
