"use client";

import type * as React from "react";

import { cn } from "../../utils";
import { Skeleton } from "../../ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../ui/table";
import { EmptyState } from "./empty-state";

type DataTableColumn<T> = {
  id: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  className?: string;
  headerClassName?: string;
  align?: "left" | "center" | "right";
};

type DataTableProps<T> = {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: ReadonlyArray<T>;
  /** Stable key per row: a property name or a function. */
  rowKey: keyof T | ((row: T) => React.Key);
  loading?: boolean;
  /** Skeleton rows shown while loading. */
  loadingRows?: number;
  /** Rendered when there are no rows (and not loading). */
  empty?: React.ReactNode;
  onRowClick?: (row: T) => void;
  /** Accessible name for a clickable row, e.g. `(order) => \`Open order ${order.number}\``. */
  rowLabel?: (row: T) => string;
  caption?: React.ReactNode;
  className?: string;
  "aria-label"?: string;
};

const alignClass = { left: "text-left", center: "text-center", right: "text-right" } as const;

function resolveKey<T>(row: T, rowKey: DataTableProps<T>["rowKey"], index: number): React.Key {
  if (typeof rowKey === "function") return rowKey(row);
  const value = row[rowKey];
  return typeof value === "string" || typeof value === "number" ? value : index;
}

/** Simple typed table with loading skeleton, empty state and optional row click. */
function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  loadingRows = 5,
  empty,
  onRowClick,
  rowLabel,
  caption,
  className,
  "aria-label": ariaLabel,
}: DataTableProps<T>) {
  const isEmpty = !loading && rows.length === 0;

  return (
    <div
      data-slot="data-table"
      className={cn("overflow-hidden rounded-xl border bg-card", className)}
    >
      <Table aria-label={ariaLabel} aria-busy={loading || undefined}>
        {caption && <TableCaption className="sr-only">{caption}</TableCaption>}
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {columns.map((column) => (
              <TableHead
                key={column.id}
                scope="col"
                className={cn(alignClass[column.align ?? "left"], column.headerClassName)}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading &&
            Array.from({ length: loadingRows }, (_, i) => (
              <TableRow
                key={`skeleton-${i}`}
                data-slot="data-table-skeleton-row"
                className="hover:bg-transparent"
              >
                {columns.map((column) => (
                  <TableCell key={column.id}>
                    <Skeleton className="h-4 w-full max-w-40" />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          {isEmpty && (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="p-0 whitespace-normal">
                {empty ?? <EmptyState size="compact" title="No results" />}
              </TableCell>
            </TableRow>
          )}
          {!loading &&
            rows.map((row, index) => {
              const clickable = onRowClick != null;
              return (
                <TableRow
                  key={resolveKey(row, rowKey, index)}
                  data-clickable={clickable || undefined}
                  tabIndex={clickable ? 0 : undefined}
                  aria-label={clickable && rowLabel ? rowLabel(row) : undefined}
                  onClick={clickable ? () => onRowClick(row) : undefined}
                  onKeyDown={
                    clickable
                      ? (event) => {
                          if (event.target !== event.currentTarget) return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onRowClick(row);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    clickable &&
                      "cursor-pointer outline-none focus-visible:bg-muted/60 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset",
                  )}
                >
                  {columns.map((column) => (
                    <TableCell
                      key={column.id}
                      className={cn(alignClass[column.align ?? "left"], column.className)}
                    >
                      {column.cell(row, index)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
        </TableBody>
      </Table>
    </div>
  );
}

export { DataTable };
export type { DataTableColumn, DataTableProps };
