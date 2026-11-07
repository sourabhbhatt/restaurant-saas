"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { OrderDto, OrderTransitionInput } from "@/contracts/orders";
import type { OrderPriority } from "@/domain/orders/order-status";
import { api, ApiError, errorMessage } from "@/lib/api-client";

import { staffOpsKeys } from "./keys";

export type OrderListFilters = {
  status?: string;
  tableId?: string;
  sessionId?: string;
  from?: string;
  to?: string;
  orderNumber?: number;
  limit?: number;
};

export function useBranchOrders(
  branchId: string,
  filters: OrderListFilters,
  options: { refetchInterval?: number | false; enabled?: boolean } = {},
) {
  const key = { ...filters } as Record<string, string | number | undefined>;
  return useQuery({
    queryKey: staffOpsKeys.orders(branchId, key),
    queryFn: ({ signal }) => api.get<OrderDto[]>(`/branches/${branchId}/orders`, key, signal),
    refetchInterval: options.refetchInterval,
    enabled: options.enabled ?? true,
    placeholderData: (prev) => prev,
    meta: { persist: true },
  });
}

export function useOrderDetail(branchId: string, orderId: string | null) {
  return useQuery({
    queryKey: staffOpsKeys.order(branchId, orderId ?? ""),
    queryFn: ({ signal }) => api.get<OrderDto>(`/orders/${orderId}`, undefined, signal),
    enabled: Boolean(orderId),
  });
}

const ACTION_DONE: Record<OrderTransitionInput["action"], string> = {
  accept: "accepted — sent to the kitchen",
  reject: "rejected",
  start: "started",
  ready: "marked ready",
  serve: "served",
  cancel: "cancelled",
};

/** True for "someone else got there first" conflicts. */
export function isConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

/**
 * Order lifecycle transition. Never optimistic: the UI waits for the server,
 * and a 409 (another device handled it) shows a toast and refetches.
 */
export function useOrderAction(branchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      order: Pick<OrderDto, "id" | "version" | "orderNumber">;
      action: OrderTransitionInput["action"];
      reason?: string;
    }) =>
      api.post<OrderDto>(`/orders/${input.order.id}/transition`, {
        action: input.action,
        expectedVersion: input.order.version,
        ...(input.reason ? { reason: input.reason } : {}),
      }),
    onSuccess: (order, input) => {
      qc.setQueryData(staffOpsKeys.order(branchId, order.id), order);
      toast.success(`Order #${order.orderNumber} ${ACTION_DONE[input.action]}`);
    },
    onError: (error, input) => {
      if (isConflict(error)) {
        toast.warning(`Order #${input.order.orderNumber} was already handled`, {
          description: errorMessage(error),
        });
      } else {
        toast.error(errorMessage(error));
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: staffOpsKeys.branch(branchId) }),
  });
}

export function useOrderPriority(branchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { order: Pick<OrderDto, "id" | "version">; priority: OrderPriority }) =>
      api.patch<OrderDto>(`/orders/${input.order.id}/priority`, {
        priority: input.priority,
        expectedVersion: input.order.version,
      }),
    onSuccess: (order) => {
      qc.setQueryData(staffOpsKeys.order(branchId, order.id), order);
      toast.success(`Order #${order.orderNumber} priority set to ${order.priority.toLowerCase()}`);
    },
    onError: (error) => {
      toast[isConflict(error) ? "warning" : "error"](errorMessage(error));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: staffOpsKeys.branch(branchId) }),
  });
}

export function useItemStatus(branchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { orderId: string; itemId: string; status: "PREPARING" | "READY" }) =>
      api.patch<OrderDto>(`/orders/${input.orderId}/items/${input.itemId}`, {
        status: input.status,
      }),
    onSuccess: (order) => {
      qc.setQueryData(staffOpsKeys.order(branchId, order.id), order);
      if (order.status === "READY") toast.success(`Order #${order.orderNumber} is ready`);
    },
    onError: (error) => {
      toast[isConflict(error) ? "warning" : "error"](errorMessage(error));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: staffOpsKeys.branch(branchId) }),
  });
}
