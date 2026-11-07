"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { BillDto, PaymentSummaryDto } from "@ros/contracts/billing";
import type {
  BillListResponse,
  BillPreviewDto,
  CashierQueueDto,
  PaymentResultDto,
  ReceiptDto,
  SessionCloseResultDto,
} from "@ros/contracts/billing-extra";
import type { BillDiscount } from "@ros/domain/billing/bill-calculator";
import type { PaymentMethod, PaymentStatus } from "@ros/domain/billing/payments";
import { api, ApiError } from "@/lib/api-client";

export const billingKeys = {
  all: (branchId: string) => ["billing", branchId] as const,
  queue: (branchId: string) => ["billing", branchId, "queue"] as const,
  list: (branchId: string, filters: BillListFilters) =>
    ["billing", branchId, "list", filters] as const,
  summary: (branchId: string, range: { from?: string; to?: string }) =>
    ["billing", branchId, "summary", range] as const,
  bill: (billId: string) => ["bill", billId] as const,
  receipt: (billId: string) => ["bill", billId, "receipt"] as const,
};

export interface BillListFilters {
  paymentStatus?: PaymentStatus | "ALL";
  from?: string;
  to?: string;
  page: number;
  pageSize: number;
}

const noRetryOnClientError = (failureCount: number, error: unknown) =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 2;

export function useCashierQueue(branchId: string | undefined) {
  return useQuery({
    queryKey: billingKeys.queue(branchId ?? ""),
    queryFn: ({ signal }) =>
      api.get<CashierQueueDto>(`/branches/${branchId}/bills/queue`, undefined, signal),
    enabled: Boolean(branchId),
    // Realtime is only a hint; polling keeps the queue fresh regardless.
    refetchInterval: 15_000,
    retry: noRetryOnClientError,
  });
}

export function useBills(branchId: string | undefined, filters: BillListFilters) {
  return useQuery({
    queryKey: billingKeys.list(branchId ?? "", filters),
    queryFn: ({ signal }) =>
      api.get<BillListResponse>(
        `/branches/${branchId}/bills`,
        {
          paymentStatus: filters.paymentStatus === "ALL" ? undefined : filters.paymentStatus,
          from: filters.from,
          to: filters.to,
          page: filters.page,
          pageSize: filters.pageSize,
        },
        signal,
      ),
    enabled: Boolean(branchId),
    placeholderData: keepPreviousData,
    retry: noRetryOnClientError,
  });
}

export function usePaymentSummary(
  branchId: string | undefined,
  range: { from?: string; to?: string } = {},
  enabled = true,
) {
  return useQuery({
    queryKey: billingKeys.summary(branchId ?? "", range),
    queryFn: ({ signal }) =>
      api.get<PaymentSummaryDto>(`/branches/${branchId}/payments/summary`, range, signal),
    enabled: Boolean(branchId) && enabled,
    refetchInterval: 60_000,
    retry: noRetryOnClientError,
  });
}

export function useBill(billId: string | null | undefined) {
  return useQuery({
    queryKey: billingKeys.bill(billId ?? ""),
    queryFn: ({ signal }) => api.get<BillDto>(`/bills/${billId}`, undefined, signal),
    enabled: Boolean(billId),
    retry: noRetryOnClientError,
  });
}

export function useReceipt(billId: string | undefined) {
  return useQuery({
    queryKey: billingKeys.receipt(billId ?? ""),
    queryFn: ({ signal }) => api.get<ReceiptDto>(`/bills/${billId}/receipt`, undefined, signal),
    enabled: Boolean(billId),
    retry: noRetryOnClientError,
  });
}

/** Refresh everything billing-related for a branch after a change. */
function useInvalidateBilling(branchId: string) {
  const qc = useQueryClient();
  return (bill?: BillDto) => {
    if (bill) qc.setQueryData(billingKeys.bill(bill.id), bill);
    void qc.invalidateQueries({ queryKey: billingKeys.all(branchId) });
    if (bill) void qc.invalidateQueries({ queryKey: billingKeys.receipt(bill.id) });
  };
}

export function useBillPreview(branchId: string) {
  return useMutation({
    mutationFn: (input: { sessionId: string; discount?: BillDiscount | null }) =>
      api.post<BillPreviewDto>(`/branches/${branchId}/bills/preview`, input),
  });
}

export function useGenerateBill(branchId: string) {
  const refresh = useInvalidateBilling(branchId);
  return useMutation({
    mutationFn: (input: {
      sessionId: string;
      discount?: BillDiscount | null;
      idempotencyKey: string;
    }) =>
      api.post<BillDto>(`/branches/${branchId}/bills`, input, {
        idempotencyKey: input.idempotencyKey,
      }),
    onSuccess: (bill) => refresh(bill),
  });
}

export interface RecordPaymentVars {
  billId: string;
  method: PaymentMethod;
  amount: number;
  tendered?: number;
  reference?: string;
  note?: string;
  idempotencyKey: string;
}

export function useRecordPayment(branchId: string) {
  const refresh = useInvalidateBilling(branchId);
  return useMutation({
    mutationFn: ({ billId, ...body }: RecordPaymentVars) =>
      api.post<PaymentResultDto>(`/bills/${billId}/payments`, body, {
        idempotencyKey: body.idempotencyKey,
      }),
    onSuccess: (result) => refresh(result.bill),
  });
}

export function useRefund(branchId: string) {
  const refresh = useInvalidateBilling(branchId);
  return useMutation({
    mutationFn: ({
      billId,
      ...body
    }: {
      billId: string;
      method: PaymentMethod;
      amount: number;
      reference?: string;
      note: string;
      idempotencyKey: string;
    }) =>
      api.post<PaymentResultDto>(`/bills/${billId}/refunds`, body, {
        idempotencyKey: body.idempotencyKey,
      }),
    onSuccess: (result) => refresh(result.bill),
  });
}

export function useVoidPayment(branchId: string) {
  const refresh = useInvalidateBilling(branchId);
  return useMutation({
    mutationFn: ({ paymentId, reason }: { paymentId: string; reason: string }) =>
      api.post<BillDto>(`/payments/${paymentId}/void`, { reason }),
    onSuccess: (bill) => refresh(bill),
  });
}

export function useVoidBill(branchId: string) {
  const refresh = useInvalidateBilling(branchId);
  return useMutation({
    mutationFn: ({ billId, reason }: { billId: string; reason: string }) =>
      api.post<BillDto>(`/bills/${billId}/void`, { reason }),
    onSuccess: (bill) => refresh(bill),
  });
}

export function useCloseSession(branchId: string) {
  const refresh = useInvalidateBilling(branchId);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId }: { sessionId: string; billId?: string | null }) =>
      api.post<SessionCloseResultDto>(`/branches/${branchId}/sessions/${sessionId}/close`),
    onSuccess: (_result, vars) => {
      refresh();
      if (vars.billId) void qc.invalidateQueries({ queryKey: billingKeys.bill(vars.billId) });
    },
  });
}

/** Reasons from a 409 close-session response. */
export function closureReasons(error: unknown): string[] {
  if (!(error instanceof ApiError)) return [];
  const reasons = error.details.reasons;
  return Array.isArray(reasons) ? reasons.filter((r): r is string => typeof r === "string") : [];
}
