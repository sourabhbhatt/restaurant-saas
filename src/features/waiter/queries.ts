"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { BillDto } from "@/contracts/billing";
import type { BillPreviewDto } from "@/contracts/billing-extra";
import type { BranchMenu } from "@/contracts/menu";
import type { OrderDto } from "@/contracts/orders";
import type { BranchSessionsDto, SessionDetailDto } from "@/contracts/staff-ops";
import { api, ApiError } from "@/lib/api-client";
import { staffOpsKeys } from "@/features/orders/keys";

export function useBranchSessions(
  branchId: string,
  options: { refetchInterval?: number; enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: staffOpsKeys.sessions(branchId),
    queryFn: ({ signal }) =>
      api.get<BranchSessionsDto>(`/branches/${branchId}/sessions`, undefined, signal),
    refetchInterval: options.refetchInterval,
    enabled: options.enabled ?? true,
  });
}

export function useSessionDetail(
  branchId: string,
  sessionId: string | null | undefined,
  refetchInterval?: number,
) {
  return useQuery({
    queryKey: staffOpsKeys.session(branchId, sessionId ?? ""),
    queryFn: ({ signal }) =>
      api.get<SessionDetailDto>(`/branches/${branchId}/sessions/${sessionId}`, undefined, signal),
    enabled: Boolean(sessionId),
    refetchInterval,
  });
}

/** Branch-effective menu for staff ordering (menu module). 404 → not available yet. */
export function useBranchMenu(branchId: string, enabled: boolean) {
  return useQuery({
    queryKey: staffOpsKeys.menu(branchId),
    queryFn: ({ signal }) => api.get<BranchMenu>(`/branches/${branchId}/menu`, undefined, signal),
    enabled,
    staleTime: 60_000,
    retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
  });
}

export interface StaffOrderBody {
  tableId: string;
  priority: "NORMAL" | "HIGH" | "RUSH";
  specialInstructions?: string;
  idempotencyKey: string;
  lines: {
    menuItemId: string;
    variantId?: string | null;
    addonIds: string[];
    quantity: number;
    notes?: string;
  }[];
}

export function useStaffOrder(branchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StaffOrderBody) =>
      api.post<OrderDto>(`/branches/${branchId}/orders`, body, {
        idempotencyKey: body.idempotencyKey,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: staffOpsKeys.branch(branchId) }),
  });
}

export interface DiscountInput {
  type: "PERCENT" | "FLAT";
  value: number;
  reason?: string;
}

export function useBillPreview(
  branchId: string,
  sessionId: string,
  discount: DiscountInput | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...staffOpsKeys.session(branchId, sessionId), "bill-preview", discount] as const,
    queryFn: () =>
      api.post<BillPreviewDto>(`/branches/${branchId}/bills/preview`, { sessionId, discount }),
    enabled,
    retry: false,
    placeholderData: (prev) => prev,
  });
}

export function useGenerateBill(branchId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { sessionId: string; discount: DiscountInput | null; idempotencyKey: string }) =>
      api.post<BillDto>(`/branches/${branchId}/bills`, body, {
        idempotencyKey: body.idempotencyKey,
      }),
    onSettled: () => qc.invalidateQueries({ queryKey: staffOpsKeys.branch(branchId) }),
  });
}
