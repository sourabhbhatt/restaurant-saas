"use client";

import { useQuery } from "@tanstack/react-query";

import type { BranchMenu } from "@ros/contracts/menu";
import type { OrderDto } from "@ros/contracts/orders";
import type { TableDto, TableQrDto } from "@ros/contracts/tables";
import { BILLABLE_ORDER_STATUSES, type OrderStatus } from "@ros/domain/orders/order-status";
import { api, ApiError } from "@ros/api-client";

/**
 * Keys shared with the console's menu and tables features, so the checklist
 * reads the same cache and updates as soon as those pages change something.
 */
const keys = {
  branchMenu: (branchId: string) => ["menu", "branch", branchId] as const,
  tables: (branchId: string) => ["tables", "list", branchId] as const,
  qr: (tableId: string) => ["tables", "qr", tableId] as const,
  anyOrder: (branchId: string) => ["setup", branchId, "any-order"] as const,
  acceptedOrder: (branchId: string) => ["setup", branchId, "accepted-order"] as const,
};

/** Same rule as the console's menu and tables queries: 401/403/404 are final. */
const noRetryOnAuth = (failureCount: number, error: unknown) =>
  !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && failureCount < 2;

/**
 * Orders that were accepted at some point. CANCELLED counts: cancelling is only
 * possible after accepting (ACCEPTED, PREPARING or READY), and the checklist
 * itself tells owners to cancel the test order afterwards.
 */
export const ACCEPTED_ONCE_STATUSES: readonly OrderStatus[] = [
  ...BILLABLE_ORDER_STATUSES,
  "CANCELLED",
];

/** While the owner is placing or accepting the test order, check for it this often. */
export const SETUP_POLL_MS = 30_000;

export type SetupStepKey = "menu" | "tables" | "qr" | "test-order" | "accept";

export interface SetupProgress {
  /** False until every source has answered. */
  ready: boolean;
  done: Record<SetupStepKey, boolean>;
  /** Active tables with a QR code, of all active tables (shown as information). */
  qrTables: { withCode: number; total: number };
  /** Guest page of a table that already has a QR code (for a test order). */
  guestUrl: string | null;
}

/** Pure: which first-order steps are complete, from real branch data. */
export function setupDone(input: {
  menu: BranchMenu | undefined;
  tables: TableDto[] | undefined;
  anyOrder: OrderDto[] | undefined;
  acceptedOrder: OrderDto[] | undefined;
}): Record<SetupStepKey, boolean> {
  const items = input.menu?.categories.reduce((n, c) => n + c.items.length, 0) ?? 0;
  const tables = (input.tables ?? []).filter((t) => t.isActive);
  return {
    menu: items > 0,
    tables: tables.length > 0,
    // One table with a code is enough to take orders; counters and parcel tables may never get one.
    qr: tables.some((t) => t.qr.active),
    "test-order": (input.anyOrder ?? []).length > 0,
    accept: (input.acceptedOrder ?? []).some((o) => ACCEPTED_ONCE_STATUSES.includes(o.status)),
  };
}

/** The checklist's goal: a QR code is live and a first order has been accepted. */
export const setupGoalReached = (done: Record<SetupStepKey, boolean>) => done.qr && done.accept;

/**
 * Real progress of a branch towards its first order. Pass `enabled: false` once
 * the checklist is finished or hidden: nothing is fetched or polled after that.
 */
export function useBranchSetupProgress(branchId: string, enabled: boolean): SetupProgress {
  const menu = useQuery({
    queryKey: keys.branchMenu(branchId),
    queryFn: ({ signal }) =>
      api.get<BranchMenu>(`/branches/${branchId}/menu`, { includeUnavailable: "true" }, signal),
    enabled,
    retry: noRetryOnAuth,
  });
  const tables = useQuery({
    queryKey: keys.tables(branchId),
    queryFn: ({ signal }) => api.get<TableDto[]>(`/branches/${branchId}/tables`, undefined, signal),
    enabled,
    retry: noRetryOnAuth,
  });
  const anyQr = Boolean(tables.data?.some((t) => t.isActive && t.qr.active));
  // Two one-row lookups instead of a page of recent orders: a rush of pending
  // orders can never hide the accepted one, and nothing is polled once found.
  const anyOrder = useQuery({
    queryKey: keys.anyOrder(branchId),
    queryFn: ({ signal }) =>
      api.get<OrderDto[]>(`/branches/${branchId}/orders`, { limit: 1 }, signal),
    enabled,
    retry: noRetryOnAuth,
    refetchInterval: (q) => (enabled && anyQr && !q.state.data?.length ? SETUP_POLL_MS : false),
  });
  const placed = Boolean(anyOrder.data?.length);
  const acceptedOrder = useQuery({
    queryKey: keys.acceptedOrder(branchId),
    queryFn: ({ signal }) =>
      api.get<OrderDto[]>(
        `/branches/${branchId}/orders`,
        { status: ACCEPTED_ONCE_STATUSES.join(","), limit: 1 },
        signal,
      ),
    enabled,
    retry: noRetryOnAuth,
    refetchInterval: (q) => (enabled && placed && !q.state.data?.length ? SETUP_POLL_MS : false),
  });
  const done = setupDone({
    menu: menu.data,
    tables: tables.data,
    anyOrder: anyOrder.data,
    acceptedOrder: acceptedOrder.data,
  });
  const activeTables = (tables.data ?? []).filter((t) => t.isActive);
  const withQr = activeTables.find((t) => t.qr.active);
  // The guest link is only needed until the test order exists.
  const qr = useQuery({
    queryKey: keys.qr(withQr?.id ?? ""),
    queryFn: ({ signal }) => api.get<TableQrDto>(`/tables/${withQr!.id}/qr`, undefined, signal),
    enabled: enabled && Boolean(withQr) && anyOrder.isSuccess && !placed,
    staleTime: 5 * 60_000,
    retry: noRetryOnAuth,
  });
  return {
    ready: menu.isSuccess && tables.isSuccess && anyOrder.isSuccess && acceptedOrder.isSuccess,
    done,
    qrTables: {
      withCode: activeTables.filter((t) => t.qr.active).length,
      total: activeTables.length,
    },
    guestUrl: qr.data?.url ?? null,
  };
}
