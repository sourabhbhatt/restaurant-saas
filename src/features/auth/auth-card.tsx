import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Heading + body + footer used by every auth screen. */
export function AuthCard({
  title,
  description,
  children,
  footer,
  icon,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex w-full flex-col gap-6 rounded-2xl border bg-card p-6 shadow-sm sm:p-8",
        className,
      )}
    >
      <div className="flex flex-col gap-2">
        {icon && (
          <div className="mb-2 flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary [&_svg]:size-5">
            {icon}
          </div>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
      {footer && <div className="text-center text-sm text-muted-foreground">{footer}</div>}
    </div>
  );
}

export function AuthCardSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading"
      className="flex w-full flex-col gap-6 rounded-2xl border bg-card p-6 shadow-sm sm:p-8"
    >
      <div className="flex flex-col gap-2">
        <div className="h-7 w-40 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="flex flex-col gap-4">
        <div className="h-10 animate-pulse rounded-md bg-muted" />
        <div className="h-10 animate-pulse rounded-md bg-muted" />
        <div className="h-10 animate-pulse rounded-md bg-primary/20" />
      </div>
    </div>
  );
}
