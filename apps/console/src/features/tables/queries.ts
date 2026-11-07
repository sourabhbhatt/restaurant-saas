"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  BulkCreateTablesInput,
  CreateTableInput,
  QrSheetDto,
  TableDto,
  TableQrDto,
  UpdateTableInput,
} from "@ros/contracts/tables";
import { ApiError, api } from "@ros/api-client";

const tableKeys = {
  all: ["tables"] as const,
  list: (branchId: string) => ["tables", "list", branchId] as const,
  qr: (tableId: string) => ["tables", "qr", tableId] as const,
  sheet: (branchId: string, ids: string) => ["tables", "sheet", branchId, ids] as const,
};

const noRetryOnAuth = (failureCount: number, error: unknown) =>
  !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && failureCount < 2;

export function useTables(branchId: string, enabled = true) {
  return useQuery({
    queryKey: tableKeys.list(branchId),
    queryFn: ({ signal }) => api.get<TableDto[]>(`/branches/${branchId}/tables`, undefined, signal),
    enabled,
    retry: noRetryOnAuth,
    // Status is derived from live sessions; keep it fresh without realtime.
    refetchInterval: 30_000,
  });
}

export function useTableQr(tableId: string | null, enabled = true) {
  return useQuery({
    queryKey: tableKeys.qr(tableId ?? ""),
    queryFn: ({ signal }) => api.get<TableQrDto>(`/tables/${tableId}/qr`, undefined, signal),
    enabled: Boolean(tableId) && enabled,
    retry: noRetryOnAuth,
    staleTime: 5 * 60_000,
  });
}

export function useQrSheet(branchId: string, tableIds: string[]) {
  const ids = tableIds.join(",");
  return useQuery({
    queryKey: tableKeys.sheet(branchId, ids),
    queryFn: ({ signal }) =>
      api.get<QrSheetDto>(
        `/branches/${branchId}/tables/qr-sheet`,
        { tableIds: ids || undefined },
        signal,
      ),
    enabled: Boolean(branchId),
    retry: noRetryOnAuth,
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: tableKeys.all });
}

export function useCreateTable(branchId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: CreateTableInput) =>
      api.post<TableDto>(`/branches/${branchId}/tables`, input),
    onSuccess: invalidate,
  });
}

export function useBulkCreateTables(branchId: string) {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (input: BulkCreateTablesInput) =>
      api.post<TableDto[]>(`/branches/${branchId}/tables/bulk`, input),
    onSuccess: invalidate,
  });
}

export function useUpdateTable() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateTableInput & { id: string }) =>
      api.patch<TableDto>(`/tables/${id}`, input),
    onSettled: invalidate,
  });
}

export function useDeleteTable() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/tables/${id}`),
    onSuccess: invalidate,
  });
}

export function useGenerateQr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tableId: string) => api.post<TableQrDto>(`/tables/${tableId}/qr`),
    onSuccess: (data) => {
      qc.setQueryData(tableKeys.qr(data.tableId), data);
      void qc.invalidateQueries({ queryKey: ["tables", "list"] });
      void qc.invalidateQueries({ queryKey: ["tables", "sheet"] });
    },
  });
}

export function useRevokeQr() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tableId: string) => api.delete<{ revoked: boolean }>(`/tables/${tableId}/qr`),
    onSuccess: (_d, tableId) => {
      qc.removeQueries({ queryKey: tableKeys.qr(tableId) });
      void qc.invalidateQueries({ queryKey: ["tables", "list"] });
      void qc.invalidateQueries({ queryKey: ["tables", "sheet"] });
    },
  });
}
