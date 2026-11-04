import type * as React from "react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";

type LoadingStateProps = React.ComponentProps<"div"> & {
  label?: string;
  /** Visually show the label next to the spinner (it is always announced). */
  showLabel?: boolean;
};

/** Centered spinner for small regions (panels, dialogs, buttons areas). */
function LoadingState({
  label = "Loading…",
  showLabel = true,
  className,
  ...props
}: LoadingStateProps) {
  return (
    <div
      data-slot="loading-state"
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground",
        className,
      )}
      {...props}
    >
      <Spinner decorative />
      <span className={cn(!showLabel && "sr-only")}>{label}</span>
    </div>
  );
}

type PageSkeletonVariant = "list" | "cards" | "table" | "detail";

type PageSkeletonProps = React.ComponentProps<"div"> & {
  variant?: PageSkeletonVariant;
  /** Number of repeated items (rows, cards, list items). */
  count?: number;
  label?: string;
};

// Deterministic widths: no Math.random (keeps prerendering stable).
const widths = ["w-3/4", "w-2/3", "w-5/6", "w-1/2", "w-4/5"] as const;
const widthAt = (i: number) => widths[i % widths.length];

function ListSkeleton({ count }: { count: number }) {
  return (
    <div className="divide-y rounded-xl border">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex items-center gap-3 p-4">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className={cn("h-4", widthAt(i))} />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-8 w-16" />
        </div>
      ))}
    </div>
  );
}

function CardsSkeleton({ count }: { count: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex flex-col gap-4 rounded-xl border p-6">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className={cn("h-3", widthAt(i))} />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton({ count }: { count: number }) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex gap-4 border-b bg-muted/40 px-3 py-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex gap-4 border-b px-3 py-4 last:border-0">
          {Array.from({ length: 4 }, (_, j) => (
            <Skeleton key={j} className={cn("h-4 flex-1", j === 0 && widthAt(i))} />
          ))}
        </div>
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="flex flex-col gap-4 rounded-xl border p-6 lg:col-span-2">
        <Skeleton className="h-6 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="mt-4 h-40 w-full" />
      </div>
      <div className="flex flex-col gap-4 rounded-xl border p-6">
        <Skeleton className="h-5 w-1/2" />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex justify-between gap-4">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-1/4" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Layout-shaped placeholder for a whole page or section while data loads. */
function PageSkeleton({
  variant = "list",
  count,
  label = "Loading…",
  className,
  ...props
}: PageSkeletonProps) {
  const defaultCount = variant === "cards" ? 6 : 5;
  const n = count ?? defaultCount;

  return (
    <div
      data-slot="page-skeleton"
      data-variant={variant}
      role="status"
      aria-busy="true"
      aria-live="polite"
      className={cn("flex w-full flex-col gap-6", className)}
      {...props}
    >
      <span className="sr-only">{label}</span>
      {variant !== "detail" && (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
      )}
      {variant === "list" && <ListSkeleton count={n} />}
      {variant === "cards" && <CardsSkeleton count={n} />}
      {variant === "table" && <TableSkeleton count={n} />}
      {variant === "detail" && <DetailSkeleton />}
    </div>
  );
}

export { LoadingState, PageSkeleton };
export type { LoadingStateProps, PageSkeletonProps, PageSkeletonVariant };
