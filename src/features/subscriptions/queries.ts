"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  CreateSupportRequestInput,
  PublicPlanDto,
  SubscriptionOverviewDto,
  SupportRequestDto,
} from "@/contracts/platform";
import { api, ApiError } from "@/lib/api-client";

export const subscriptionKeys = {
  overview: (workspaceId: string) => ["workspace", workspaceId, "subscription"] as const,
  publicPlans: ["public", "plans"] as const,
};

const noRetryOnAuth = (failureCount: number, error: unknown) =>
  !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && failureCount < 2;

export function useSubscriptionOverview(workspaceId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: subscriptionKeys.overview(workspaceId ?? ""),
    queryFn: ({ signal }) =>
      api.get<SubscriptionOverviewDto>(`/workspaces/${workspaceId}/subscription`, undefined, signal),
    enabled: Boolean(workspaceId) && enabled,
    retry: noRetryOnAuth,
  });
}

export function usePublicPlans() {
  return useQuery({
    queryKey: subscriptionKeys.publicPlans,
    queryFn: ({ signal }) => api.get<PublicPlanDto[]>("/public/plans", undefined, signal),
    staleTime: 5 * 60_000,
  });
}

/** Upgrade request = support request of category UPGRADE (no payment gateway yet). */
export function useRequestUpgrade(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSupportRequestInput) =>
      api.post<SupportRequestDto>(`/workspaces/${workspaceId}/support`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: subscriptionKeys.overview(workspaceId) });
      void qc.invalidateQueries({ queryKey: ["workspace", workspaceId, "support"] });
    },
  });
}
