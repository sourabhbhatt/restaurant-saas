"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  AdminPlanDto,
  AdminSettingsDto,
  AdminWorkspaceDetailDto,
  AdminWorkspaceRowDto,
  AnnouncementDto,
  AnnouncementInput,
  Paginated,
  PlanInput,
  PlatformSettings,
  PublicAnnouncementDto,
} from "@ros/contracts/platform";
import type { UpgradeRequestDetailDto, UpgradeRequestListDto } from "@ros/contracts/upgrades";
import type { SubscriptionPhase } from "@ros/domain/subscriptions/entitlements";
import type { UpgradeStatus } from "@ros/domain/subscriptions/upgrade-request";
import { api } from "@ros/api-client";

export const adminKeys = {
  all: ["admin"] as const,
  workspaces: (f: object) => ["admin", "workspaces", "list", f] as const,
  workspace: (id: string) => ["admin", "workspaces", "detail", id] as const,
  plans: ["admin", "plans"] as const,
  settings: ["admin", "settings"] as const,
  announcements: ["admin", "announcements"] as const,
  publicAnnouncements: ["public", "announcements"] as const,
};

export interface WorkspaceListFilters {
  q?: string;
  status?: "ACTIVE" | "SUSPENDED" | "DEACTIVATED";
  phase?: SubscriptionPhase;
  page: number;
}

export function useAdminWorkspaces(filters: WorkspaceListFilters) {
  return useQuery({
    queryKey: adminKeys.workspaces(filters),
    queryFn: ({ signal }) =>
      api.get<Paginated<AdminWorkspaceRowDto>>(
        "/admin/workspaces",
        { ...filters, pageSize: 25 },
        signal,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useAdminWorkspace(workspaceId: string) {
  return useQuery({
    queryKey: adminKeys.workspace(workspaceId),
    queryFn: ({ signal }) =>
      api.get<AdminWorkspaceDetailDto>(`/admin/workspaces/${workspaceId}`, undefined, signal),
  });
}

/** Generic workspace action (POST/PUT/DELETE under /admin/workspaces/:id/...). */
export function useWorkspaceAction<TBody>(
  workspaceId: string,
  request: (body: TBody) => Promise<unknown>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.workspace(workspaceId) });
      void qc.invalidateQueries({ queryKey: ["admin", "workspaces", "list"] });
    },
  });
}

export function useAdminPlans() {
  return useQuery({
    queryKey: adminKeys.plans,
    queryFn: ({ signal }) => api.get<AdminPlanDto[]>("/admin/plans", undefined, signal),
  });
}

export function useSavePlan(planId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PlanInput) =>
      planId
        ? api.patch<AdminPlanDto>(`/admin/plans/${planId}`, body)
        : api.post<AdminPlanDto>("/admin/plans", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.plans });
      void qc.invalidateQueries({ queryKey: adminKeys.settings });
      void qc.invalidateQueries({ queryKey: ["public", "plans"] });
    },
  });
}

export function useAdminSettings() {
  return useQuery({
    queryKey: adminKeys.settings,
    queryFn: ({ signal }) => api.get<AdminSettingsDto>("/admin/settings", undefined, signal),
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PlatformSettings) => api.put<AdminSettingsDto>("/admin/settings", body),
    onSuccess: (data) => qc.setQueryData(adminKeys.settings, data),
  });
}

export function useAdminAnnouncements() {
  return useQuery({
    queryKey: adminKeys.announcements,
    queryFn: ({ signal }) => api.get<AnnouncementDto[]>("/admin/announcements", undefined, signal),
  });
}

export function useSaveAnnouncement(id: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AnnouncementInput) =>
      id
        ? api.patch<AnnouncementDto>(`/admin/announcements/${id}`, body)
        : api.post<AnnouncementDto>("/admin/announcements", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.announcements });
      void qc.invalidateQueries({ queryKey: adminKeys.publicAnnouncements });
    },
  });
}

export function useDeleteAnnouncement() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/admin/announcements/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.announcements });
      void qc.invalidateQueries({ queryKey: adminKeys.publicAnnouncements });
    },
  });
}

export function usePublicAnnouncements() {
  return useQuery({
    queryKey: adminKeys.publicAnnouncements,
    queryFn: ({ signal }) =>
      api.get<PublicAnnouncementDto[]>("/public/announcements", undefined, signal),
    staleTime: 5 * 60_000,
    refetchInterval: 15 * 60_000,
    retry: 1,
  });
}

// ------------------------------------------------------------------ upgrade requests

export interface UpgradeListFilters {
  status?: UpgradeStatus;
  search?: string;
  page: number;
}

export const upgradeKeys = {
  list: (f: object) => ["admin", "upgrade-requests", "list", f] as const,
  detail: (id: string) => ["admin", "upgrade-requests", "detail", id] as const,
  all: ["admin", "upgrade-requests"] as const,
};

export function useUpgradeRequests(filters: UpgradeListFilters) {
  return useQuery({
    queryKey: upgradeKeys.list(filters),
    queryFn: ({ signal }) =>
      api.get<UpgradeRequestListDto>(
        "/admin/upgrade-requests",
        { ...filters, pageSize: 20 },
        signal,
      ),
    placeholderData: keepPreviousData,
  });
}

export function useUpgradeRequest(id: string | null) {
  return useQuery({
    queryKey: upgradeKeys.detail(id ?? ""),
    queryFn: ({ signal }) =>
      api.get<UpgradeRequestDetailDto>(`/admin/upgrade-requests/${id}`, undefined, signal),
    enabled: id !== null,
  });
}

/** Approve / reject / note. Refreshes the list, the detail and the workspace views. */
export function useUpgradeAction<TBody>(requestId: string, action: "approve" | "reject" | "notes") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TBody) => api.post(`/admin/upgrade-requests/${requestId}/${action}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: upgradeKeys.all });
      void qc.invalidateQueries({ queryKey: ["admin", "workspaces"] });
    },
  });
}
