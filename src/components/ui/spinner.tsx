import type * as React from "react";
import { LoaderCircleIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type SpinnerProps = React.ComponentProps<"svg"> & {
  /** Accessible label announced to screen readers. */
  label?: string;
  /**
   * Hide from assistive tech, for spinners next to visible text such as
   * "Saving…" inside a button.
   */
  decorative?: boolean;
};

function Spinner({ className, label = "Loading", decorative = false, ...props }: SpinnerProps) {
  const a11y = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "status", "aria-label": label } as const);

  return (
    <LoaderCircleIcon
      data-slot="spinner"
      {...a11y}
      className={cn("size-4 motion-safe:animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
export type { SpinnerProps };
