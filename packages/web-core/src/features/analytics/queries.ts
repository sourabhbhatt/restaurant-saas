"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import type {
  AdminAnalyticsDto,
  BranchAnalyticsDto,
  BranchLiveDto,
  WorkspaceAnalyticsDto,
} from "@ros/contracts/analytics";
import type { OrderDto } from "@ros/contracts/orders";
import type { WorkspaceDto } from "@ros/contracts/workspaces";
import { api, ApiError } from "@ros/api-client";

export const analyticsKeys = {
  branch: (branchId: string, from: string, to: string) =>
    ["analytics", "branch", branchId, from, to] as const,
  live: (branchId: string) => ["analytics", "branch-live", branchId] as const,
  workspace: (workspaceId: string, params: WorkspaceAnalyticsParams) =>
    ["analytics", "workspace", workspaceId, params] as const,
  admin: ["analytics", "admin"] as const,
  workspaceDetail: (workspaceId: string) => ["workspace", workspaceId, "detail"] as const,
  recentOrders: (branchId: string) => ["analytics", "recent-orders", branchId] as const,
};

/** Permission and plan errors are answers, not transient failures. */
const retry = (count: number, error: unknown) =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2;

export interface DateRangeValue {
  from: string;
  to: string;
}

export function useBranchAnalytics(
  branchId: string | undefined,
  range: DateRangeValue,
  enabled = true,
) {
  return useQuery({
    queryKey: [...analyticsKeys.branch(branchId ?? "", range.from, range.to), range],
    queryFn: ({ signal }) =>
      api.get<BranchAnalyticsDto>(`/branches/${branchId}/analytics`, { ...range }, signal),
    enabled: Boolean(branchId) && enabled,
    placeholderData: keepPreviousData,
    retry,
    staleTime: 60_000,
  });
}

export function useBranchLive(branchId: string | undefined) {
  return useQuery({
    queryKey: analyticsKeys.live(branchId ?? ""),
    queryFn: ({ signal }) =>
      api.get<BranchLiveDto>(`/branches/${branchId}/analytics/live`, undefined, signal),
    enabled: Boolean(branchId),
    refetchInterval: 30_000,
    retry,
  });
}

export interface WorkspaceAnalyticsParams extends DateRangeValue {
  restaurantId?: string;
  branchId?: string;
}

export function useWorkspaceAnalytics(
  workspaceId: string | undefined,
  params: WorkspaceAnalyticsParams,
  enabled = true,
) {
  return useQuery({
    queryKey: analyticsKeys.workspace(workspaceId ?? "", params),
    queryFn: ({ signal }) =>
      api.get<WorkspaceAnalyticsDto>(`/workspaces/${workspaceId}/analytics`, { ...params }, signal),
    enabled: Boolean(workspaceId) && enabled,
    placeholderData: keepPreviousData,
    retry,
    staleTime: 60_000,
  });
}

export function useAdminAnalytics() {
  return useQuery({
    queryKey: analyticsKeys.admin,
    queryFn: ({ signal }) => api.get<AdminAnalyticsDto>("/admin/analytics", undefined, signal),
    retry,
    staleTime: 60_000,
  });
}

export function useWorkspaceDetail(workspaceId: string | undefined) {
  return useQuery({
    queryKey: analyticsKeys.workspaceDetail(workspaceId ?? ""),
    queryFn: ({ signal }) =>
      api.get<{ workspace: WorkspaceDto; membership: { roleKey: string; permissions: string[] } }>(
        `/workspaces/${workspaceId}`,
        undefined,
        signal,
      ),
    enabled: Boolean(workspaceId),
    retry,
  });
}

/** Recent orders from the staff-ops endpoint; absent until that module ships. */
export function useRecentOrders(branchId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: analyticsKeys.recentOrders(branchId ?? ""),
    queryFn: ({ signal }) =>
      api.get<OrderDto[]>(`/branches/${branchId}/orders`, { limit: 8 }, signal),
    enabled: Boolean(branchId) && enabled,
    refetchInterval: 30_000,
    retry,
  });
}
