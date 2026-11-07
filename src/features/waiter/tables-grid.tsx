"use client";

import { BellRing, Clock3, LayoutGrid } from "lucide-react";

import { EmptyState, StatusBadge } from "@/components/shared/feedback";
import type { BranchTableDto } from "@ros/contracts/staff-ops";
import { formatMoney } from "@ros/domain/shared/money";
import { cn } from "@/lib/utils";
import { formatElapsed } from "@/features/orders/use-now";

import { TABLE_STATUS_META } from "./table-status";

export function TablesGrid({
  tables,
  currency,
  now,
  onSelect,
}: {
  tables: BranchTableDto[];
  currency: string;
  now: number;
  onSelect: (tableId: string) => void;
}) {
  if (tables.length === 0) {
    return (
      <EmptyState
        icon={<LayoutGrid />}
        title="No tables yet"
        description="A manager can add tables and QR codes under Tables & QR."
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="Legend">
        {Object.entries(TABLE_STATUS_META).map(([k, m]) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className={cn("size-3 rounded-sm border", m.tile)} aria-hidden />
            {m.label}
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
        {tables.map((t) => {
          const meta = TABLE_STATUS_META[t.status];
          const s = t.session;
          return (
            <button
              key={t.tableId}
              type="button"
              onClick={() => onSelect(t.tableId)}
              className={cn(
                "flex min-h-28 flex-col items-start gap-2 rounded-xl border-2 p-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 motion-safe:transition-colors",
                meta.tile,
              )}
              aria-label={`${t.tableName}: ${meta.label}${s?.pendingCount ? `, ${s.pendingCount} pending` : ""}`}
            >
              <div className="flex w-full items-center justify-between gap-2">
                <span className="text-lg font-semibold">{t.tableName}</span>
                {s && s.pendingCount > 0 && (
                  <span className="flex size-6 items-center justify-center rounded-full bg-warning text-xs font-bold text-warning-foreground">
                    {s.pendingCount}
                  </span>
                )}
              </div>
              <StatusBadge tone={meta.tone}>
                {t.status === "BILL_REQUESTED" && <BellRing aria-hidden />}
                {meta.label}
              </StatusBadge>
              {s ? (
                <div className="mt-auto flex w-full flex-col gap-0.5 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock3 className="size-3" aria-hidden /> {formatElapsed(s.openedAt, now)} ·{" "}
                    {s.activeCount} active
                  </span>
                  <span className="font-medium text-foreground tabular-nums">
                    {t.bill
                      ? `Due ${formatMoney(t.bill.balanceDue, t.bill.currency)}`
                      : formatMoney(s.billableSubtotal, currency)}
                  </span>
                </div>
              ) : (
                <span className="mt-auto text-xs text-muted-foreground">
                  {t.capacity} seats{t.section ? ` · ${t.section}` : ""}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
