"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  CreateSupportRequestInput,
  Paginated,
  SupportCategory,
  SupportPriority,
  SupportRequestDetailDto,
  SupportRequestDto,
  SupportStatus,
} from "@ros/contracts/platform";
import { api } from "@/lib/api-client";

export const supportKeys = {
  workspace: (workspaceId: string) => ["workspace", workspaceId, "support"] as const,
  workspaceList: (workspaceId: string, filters: object) =>
    ["workspace", workspaceId, "support", filters] as const,
  admin: ["admin", "support"] as const,
  adminList: (filters: object) => ["admin", "support", "list", filters] as const,
  adminDetail: (id: string) => ["admin", "support", "detail", id] as const,
};

export interface WorkspaceSupportFilters {
  status?: SupportStatus;
  page: number;
}

export function useWorkspaceSupport(workspaceId: string, filters: WorkspaceSupportFilters) {
  return useQuery({
    queryKey: supportKeys.workspaceList(workspaceId, filters),
    queryFn: ({ signal }) =>
      api.get<Paginated<SupportRequestDto> & { canCreate: boolean }>(
        `/workspaces/${workspaceId}/support`,
        { status: filters.status, page: filters.page, pageSize: 20 },
        signal,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useCreateSupportRequest(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSupportRequestInput) =>
      api.post<SupportRequestDto>(`/workspaces/${workspaceId}/support`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: supportKeys.workspace(workspaceId) });
      void qc.invalidateQueries({ queryKey: ["workspace", workspaceId, "subscription"] });
    },
  });
}

export interface AdminSupportFilters {
  q?: string;
  status?: SupportStatus;
  category?: SupportCategory;
  priority?: SupportPriority;
  assigned?: "me" | "unassigned";
  page: number;
}

export function useAdminSupportList(filters: AdminSupportFilters) {
  return useQuery({
    queryKey: supportKeys.adminList(filters),
    queryFn: ({ signal }) =>
      api.get<Paginated<SupportRequestDto>>("/admin/support", { ...filters, pageSize: 25 }, signal),
    placeholderData: keepPreviousData,
  });
}

export function useAdminSupportRequest(id: string) {
  return useQuery({
    queryKey: supportKeys.adminDetail(id),
    queryFn: ({ signal }) =>
      api.get<SupportRequestDetailDto>(`/admin/support/${id}`, undefined, signal),
  });
}

export function useUpdateSupportRequest(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      status?: SupportStatus;
      priority?: SupportPriority;
      assignee?: "me" | null;
    }) => api.patch<SupportRequestDetailDto>(`/admin/support/${id}`, body),
    onSuccess: (data) => {
      qc.setQueryData(supportKeys.adminDetail(id), data);
      void qc.invalidateQueries({ queryKey: [...supportKeys.admin, "list"] });
    },
  });
}

export function useAddSupportNote(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { body: string }) =>
      api.post<SupportRequestDetailDto>(`/admin/support/${id}/notes`, body),
    onSuccess: (data) => qc.setQueryData(supportKeys.adminDetail(id), data),
  });
}
