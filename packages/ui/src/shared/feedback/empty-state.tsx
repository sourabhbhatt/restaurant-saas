import type * as React from "react";

import { cn } from "../../utils";

type EmptyStateProps = Omit<React.ComponentProps<"div">, "title"> & {
  /** An icon element, e.g. `<InboxIcon />`. */
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Call to action, e.g. a `<Button>`. */
  action?: React.ReactNode;
  size?: "default" | "compact";
};

function EmptyState({
  icon,
  title,
  description,
  action,
  size = "default",
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-3 text-center text-balance",
        size === "default" ? "rounded-xl border border-dashed px-6 py-12" : "px-4 py-8",
        className,
      )}
      {...props}
    >
      {icon && (
        <div
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary [&_svg:not([class*='size-'])]:size-6"
        >
          {icon}
        </div>
      )}
      <div className="flex max-w-sm flex-col gap-1">
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {action && (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div>
      )}
    </div>
  );
}

export { EmptyState };
export type { EmptyStateProps };
