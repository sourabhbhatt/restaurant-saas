"use client";

import { useQuery } from "@tanstack/react-query";

import type { BranchMenu } from "@ros/contracts/menu";
import type { OrderDto } from "@ros/contracts/orders";
import type { TableDto, TableQrDto } from "@ros/contracts/tables";
import { api } from "@ros/api-client";

import { useRecentOrders } from "../analytics/queries";

/**
 * Keys shared with the console's menu and tables features, so the checklist
 * reads the same cache and updates as soon as those pages change something.
 */
const keys = {
  branchMenu: (branchId: string) => ["menu", "branch", branchId] as const,
  tables: (branchId: string) => ["tables", "list", branchId] as const,
  qr: (tableId: string) => ["tables", "qr", tableId] as const,
};

export type SetupStepKey = "menu" | "tables" | "qr" | "test-order" | "accept";

export interface SetupProgress {
  /** False until every source has answered. */
  ready: boolean;
  done: Record<SetupStepKey, boolean>;
  /** Guest page of a table that already has a QR code (for a test order). */
  guestUrl: string | null;
}

/** Orders a waiter has accepted (anything past "waiting for approval"). */
const ACCEPTED = new Set(["ACCEPTED", "PREPARING", "READY", "SERVED", "COMPLETED"]);

/** Pure: which first-order steps are complete, from real branch data. */
export function setupDone(input: {
  menu: BranchMenu | undefined;
  tables: TableDto[] | undefined;
  orders: OrderDto[] | undefined;
}): Record<SetupStepKey, boolean> {
  const items = input.menu?.categories.reduce((n, c) => n + c.items.length, 0) ?? 0;
  const tables = (input.tables ?? []).filter((t) => t.isActive);
  const orders = input.orders ?? [];
  return {
    menu: items > 0,
    tables: tables.length > 0,
    qr: tables.length > 0 && tables.every((t) => t.qr.active),
    "test-order": orders.length > 0,
    accept: orders.some((o) => ACCEPTED.has(o.status)),
  };
}

/** Real progress of a branch towards its first order. */
export function useBranchSetupProgress(branchId: string, enabled: boolean): SetupProgress {
  const menu = useQuery({
    queryKey: keys.branchMenu(branchId),
    queryFn: ({ signal }) =>
      api.get<BranchMenu>(`/branches/${branchId}/menu`, { includeUnavailable: "true" }, signal),
    enabled,
  });
  const tables = useQuery({
    queryKey: keys.tables(branchId),
    queryFn: ({ signal }) => api.get<TableDto[]>(`/branches/${branchId}/tables`, undefined, signal),
    enabled,
  });
  const orders = useRecentOrders(branchId, enabled);
  const withQr = tables.data?.find((t) => t.isActive && t.qr.active);
  const qr = useQuery({
    queryKey: keys.qr(withQr?.id ?? ""),
    queryFn: ({ signal }) => api.get<TableQrDto>(`/tables/${withQr!.id}/qr`, undefined, signal),
    enabled: enabled && Boolean(withQr),
    staleTime: 5 * 60_000,
  });
  return {
    ready: menu.isSuccess && tables.isSuccess && orders.isSuccess,
    done: setupDone({ menu: menu.data, tables: tables.data, orders: orders.data }),
    guestUrl: qr.data?.url ?? null,
  };
}
