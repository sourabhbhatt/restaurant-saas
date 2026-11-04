import type * as React from "react";

import { cn } from "@/lib/utils";

type FilterBarProps = React.ComponentProps<"div"> & {
  /** Right-aligned actions such as "Reset filters" or "Export". */
  actions?: React.ReactNode;
};

/**
 * Responsive layout for list filters: a search field that grows, followed by
 * selects/toggles. Stacks on mobile, wraps on tablets, single row on desktop.
 */
function FilterBar({
  actions,
  className,
  children,
  "aria-label": ariaLabel = "Filters",
  ...props
}: FilterBarProps) {
  return (
    <div
      data-slot="filter-bar"
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center",
        "*:data-[slot=select-trigger]:w-full *:data-[slot=search-input]:sm:max-w-xs *:data-[slot=search-input]:sm:flex-1 *:data-[slot=select-trigger]:sm:w-44",
        className,
      )}
      {...props}
    >
      {children}
      {actions && <div className="flex items-center gap-2 sm:ml-auto">{actions}</div>}
    </div>
  );
}

export { FilterBar };
export type { FilterBarProps };
