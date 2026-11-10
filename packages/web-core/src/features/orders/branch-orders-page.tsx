"use client";

import { ClipboardList } from "lucide-react";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";

import {
  DataTable,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  type DataTableColumn,
} from "@ros/ui/shared/feedback";
import { Button } from "@ros/ui/ui/button";
import { SearchInput } from "@ros/ui/ui/search-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ros/ui/ui/select";
import type { OrderDto } from "@ros/contracts/orders";
import { ORDER_STATUSES } from "@ros/domain/orders/order-status";
import { formatMoney } from "@ros/domain/shared/money";
import { errorMessage } from "@ros/api-client";
import { ConnectionStatus } from "../realtime/connection-status";
import { useBranchEvents } from "../realtime/use-branch-events";
import { permissionChecker, useBranchContext } from "../session/queries";

import { OrderDetailSheet } from "./order-detail-sheet";
import { ORDER_STATUS_META, OrderStatusBadge, PriorityBadge } from "./order-ui";
import { useBranchOrders, type OrderListFilters } from "./queries";
import { formatClock, formatElapsed, useNow } from "./use-now";

const DATE_RANGES = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Last 7 days",
  all: "All time",
} as const;
type DateRange = keyof typeof DATE_RANGES;

function rangeFor(range: DateRange, day: string): { from?: string; to?: string } {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  if (range === "today") return { from: start.toISOString() };
  if (range === "yesterday") {
    const from = new Date(start.getTime() - 86_400_000);
    return { from: from.toISOString(), to: new Date(start.getTime() - 1).toISOString() };
  }
  if (range === "week") return { from: new Date(start.getTime() - 6 * 86_400_000).toISOString() };
  return {};
}

/** /app/b/[branchId]/orders — filterable order list with a detail sheet. */
export function BranchOrdersPage() {
  const { branchId } = useParams<{ branchId: string }>();
  const ctx = useBranchContext(branchId);
  const can = permissionChecker(ctx.data?.permissions);
  const realtime = useBranchEvents(branchId);
  const now = useNow(30_000);

  const [status, setStatus] = useState<string>("all");
  const [range, setRange] = useState<DateRange>("today");
  const [tableId, setTableId] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const orderNumber = /^\d+$/.test(search.trim().replace(/^#/, ""))
    ? Number(search.trim().replace(/^#/, ""))
    : undefined;
  // The date window only moves when the day changes, so the query key stays stable.
  const day = new Date(now).toDateString();
  const filters = useMemo<OrderListFilters>(
    () => ({
      ...rangeFor(range, day),
      status: status === "all" ? undefined : status,
      tableId: tableId === "all" ? undefined : tableId,
      orderNumber,
      limit: 200,
    }),
    [range, day, status, tableId, orderNumber],
  );
  const orders = useBranchOrders(branchId, filters, {
    refetchInterval: realtime.pollInterval,
    enabled: can("orders.view"),
  });

  const tables = useMemo(() => {
    const map = new Map<string, string>();
    for (const o of orders.data ?? []) map.set(o.tableId, o.tableName);
    return [...map.entries()].sort((a, b) =>
      a[1].localeCompare(b[1], undefined, { numeric: true }),
    );
  }, [orders.data]);

  const filtersActive = status !== "all" || range !== "today" || tableId !== "all" || search !== "";
  const reset = () => {
    setStatus("all");
    setRange("today");
    setTableId("all");
    setSearch("");
  };

  const columns: DataTableColumn<OrderDto>[] = [
    {
      id: "number",
      header: "Order",
      cell: (o) => (
        <div className="flex items-center gap-2">
          <span className="font-semibold tabular-nums">#{o.orderNumber}</span>
          <PriorityBadge priority={o.priority} />
        </div>
      ),
    },
    { id: "table", header: "Table", cell: (o) => o.tableName },
    { id: "status", header: "Status", cell: (o) => <OrderStatusBadge status={o.status} /> },
    {
      id: "items",
      header: "Items",
      className: "max-w-56 truncate",
      headerClassName: "hidden md:table-cell",
      cell: (o) => (
        <span className="hidden text-muted-foreground md:inline">
          {o.items.map((i) => `${i.quantity}× ${i.itemName}`).join(", ")}
        </span>
      ),
    },
    {
      id: "total",
      header: "Total",
      align: "right",
      cell: (o) => <span className="tabular-nums">{formatMoney(o.subtotal, o.currency)}</span>,
    },
    {
      id: "placed",
      header: "Placed",
      headerClassName: "hidden sm:table-cell",
      cell: (o) => (
        <span className="hidden text-muted-foreground sm:inline">
          {formatClock(o.createdAt)}
          {["PENDING", "ACCEPTED", "PREPARING", "READY"].includes(o.status) && (
            <> · {formatElapsed(o.createdAt, now)}</>
          )}
        </span>
      ),
    },
    {
      id: "staff",
      header: "Accepted by",
      headerClassName: "hidden lg:table-cell",
      cell: (o) => (
        <span className="hidden text-muted-foreground lg:inline">
          {o.acceptedByName ?? (o.source === "STAFF" ? "Staff order" : "—")}
        </span>
      ),
    },
  ];

  if (ctx.data && !can("orders.view")) {
    return (
      <ErrorState
        title="No access to orders"
        message="Your role at this branch does not include viewing orders."
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Orders"
        description="Every order at this branch, with status history and staff attribution."
        actions={<ConnectionStatus status={realtime.status} lastSyncedAt={orders.dataUpdatedAt} />}
      />
      <FilterBar
        actions={
          filtersActive ? (
            <Button variant="ghost" size="sm" onClick={reset}>
              Reset filters
            </Button>
          ) : null
        }
      >
        <SearchInput
          value={search}
          onValueChange={setSearch}
          placeholder="Order number, e.g. 42"
          aria-label="Search by order number"
          inputMode="numeric"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {ORDER_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {ORDER_STATUS_META[s].label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={range} onValueChange={(v) => setRange(v as DateRange)}>
          <SelectTrigger aria-label="Date">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(DATE_RANGES) as DateRange[]).map((r) => (
              <SelectItem key={r} value={r}>
                {DATE_RANGES[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tableId} onValueChange={setTableId}>
          <SelectTrigger aria-label="Table">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tables</SelectItem>
            {tables.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FilterBar>

      {orders.isError && !orders.data ? (
        <ErrorState
          message={errorMessage(orders.error)}
          onRetry={() => void orders.refetch()}
          retrying={orders.isFetching}
        />
      ) : (
        <DataTable
          aria-label="Orders"
          columns={columns}
          rows={orders.data ?? []}
          rowKey="id"
          loading={orders.isPending}
          onRowClick={(o) => setOpenId(o.id)}
          rowLabel={(o) => `Open order ${o.orderNumber}`}
          empty={
            <EmptyState
              headingLevel={2}
              size="compact"
              icon={<ClipboardList />}
              title={filtersActive ? "No orders match these filters" : "No orders today yet"}
              description={
                filtersActive
                  ? "Try a different status, date or table."
                  : "New QR and staff orders appear here as they come in."
              }
              action={
                filtersActive ? (
                  <Button variant="outline" size="sm" onClick={reset}>
                    Reset filters
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}
      <OrderDetailSheet
        branchId={branchId}
        orderId={openId}
        onOpenChange={(o) => !o && setOpenId(null)}
        can={can}
      />
    </div>
  );
}
