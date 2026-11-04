"use client";

import type * as React from "react";
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

type PaginationItem = { type: "page"; page: number } | { type: "ellipsis"; key: string };

/**
 * Compute the visible page items: first, last, the current page and `siblingCount`
 * neighbours on each side, with ellipses for the gaps. Pages are 1-based.
 */
function getPaginationItems(page: number, pageCount: number, siblingCount = 1): PaginationItem[] {
  if (pageCount < 1) return [];
  const current = Math.min(Math.max(1, page), pageCount);
  // first + last + current + 2*siblings + 2 ellipses
  const totalSlots = siblingCount * 2 + 5;

  if (pageCount <= totalSlots) {
    return Array.from({ length: pageCount }, (_, i) => ({ type: "page", page: i + 1 }));
  }

  const start = Math.max(2, current - siblingCount);
  const end = Math.min(pageCount - 1, current + siblingCount);
  const showLeftEllipsis = start > 3;
  const showRightEllipsis = end < pageCount - 2;

  const items: PaginationItem[] = [{ type: "page", page: 1 }];

  if (!showLeftEllipsis && showRightEllipsis) {
    const leftCount = 3 + siblingCount * 2;
    for (let p = 2; p <= leftCount; p++) items.push({ type: "page", page: p });
    items.push({ type: "ellipsis", key: "end" });
  } else if (showLeftEllipsis && !showRightEllipsis) {
    items.push({ type: "ellipsis", key: "start" });
    const rightCount = 3 + siblingCount * 2;
    for (let p = pageCount - rightCount + 1; p < pageCount; p++)
      items.push({ type: "page", page: p });
  } else {
    if (showLeftEllipsis) items.push({ type: "ellipsis", key: "start" });
    for (let p = start; p <= end; p++) items.push({ type: "page", page: p });
    if (showRightEllipsis) items.push({ type: "ellipsis", key: "end" });
  }

  items.push({ type: "page", page: pageCount });
  return items;
}

type PaginationProps = Omit<React.ComponentProps<"nav">, "onChange"> & {
  /** Current page, 1-based. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Pages shown on each side of the current one. */
  siblingCount?: number;
  disabled?: boolean;
  labels?: {
    nav?: string;
    previous?: string;
    next?: string;
    page?: (page: number) => string;
    status?: (page: number, pageCount: number) => string;
  };
};

const defaultLabels = {
  nav: "Pagination",
  previous: "Previous",
  next: "Next",
  page: (page: number) => `Page ${page}`,
  status: (page: number, pageCount: number) => `Page ${page} of ${pageCount}`,
};

/** Accessible, controlled pagination. Renders nothing when there are no pages. */
function Pagination({
  page,
  pageCount,
  onPageChange,
  siblingCount = 1,
  disabled = false,
  labels: labelsProp,
  className,
  ...props
}: PaginationProps) {
  if (pageCount < 1) return null;

  const labels = { ...defaultLabels, ...labelsProp };
  const current = Math.min(Math.max(1, page), pageCount);
  const items = getPaginationItems(current, pageCount, siblingCount);
  const canPrev = !disabled && current > 1;
  const canNext = !disabled && current < pageCount;

  const go = (target: number) => {
    if (disabled || target === current || target < 1 || target > pageCount) return;
    onPageChange(target);
  };

  return (
    <nav
      data-slot="pagination"
      aria-label={labels.nav}
      className={cn("flex w-full items-center justify-center", className)}
      {...props}
    >
      <ul className="flex flex-row items-center gap-1">
        <li>
          <button
            type="button"
            onClick={() => go(current - 1)}
            disabled={!canPrev}
            aria-label={labels.previous}
            className={cn(buttonVariants({ variant: "ghost", size: "default" }), "gap-1 px-2.5")}
          >
            <ChevronLeftIcon />
            <span className="hidden sm:inline">{labels.previous}</span>
          </button>
        </li>
        {/* Compact status on small screens; full page list from `sm` up. */}
        <li className="px-2 text-sm text-muted-foreground sm:hidden" aria-live="polite">
          {labels.status(current, pageCount)}
        </li>
        {items.map((item) =>
          item.type === "ellipsis" ? (
            <li key={`ellipsis-${item.key}`} className="hidden sm:block" aria-hidden="true">
              <span className="flex size-9 items-center justify-center text-muted-foreground">
                <MoreHorizontalIcon className="size-4" />
              </span>
            </li>
          ) : (
            <li key={item.page} className="hidden sm:block">
              <button
                type="button"
                onClick={() => go(item.page)}
                disabled={disabled}
                aria-label={labels.page(item.page)}
                aria-current={item.page === current ? "page" : undefined}
                data-active={item.page === current || undefined}
                className={cn(
                  buttonVariants({
                    variant: item.page === current ? "outline" : "ghost",
                    size: "icon",
                  }),
                  "data-active:border-primary/40 data-active:text-primary",
                )}
              >
                {item.page}
              </button>
            </li>
          ),
        )}
        <li>
          <button
            type="button"
            onClick={() => go(current + 1)}
            disabled={!canNext}
            aria-label={labels.next}
            className={cn(buttonVariants({ variant: "ghost", size: "default" }), "gap-1 px-2.5")}
          >
            <span className="hidden sm:inline">{labels.next}</span>
            <ChevronRightIcon />
          </button>
        </li>
      </ul>
    </nav>
  );
}

export { Pagination, getPaginationItems };
export type { PaginationItem, PaginationProps };
