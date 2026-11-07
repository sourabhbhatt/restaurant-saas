"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  CheckoutSessionDto,
  CheckoutVerifyDto,
  CreateCheckoutInput,
  VerifyCheckoutInput,
} from "@ros/contracts/payments";
import type { PublicPlanDto, SubscriptionOverviewDto } from "@ros/contracts/platform";
import type { CreateUpgradeRequestInput, UpgradeRequestDto } from "@ros/contracts/upgrades";
import { api, ApiError } from "@ros/api-client";

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
      api.get<SubscriptionOverviewDto>(
        `/workspaces/${workspaceId}/subscription`,
        undefined,
        signal,
      ),
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

/** Ask Super Admin to change the plan (no payment gateway yet: approved manually). */
export function useRequestUpgrade(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateUpgradeRequestInput) =>
      api.post<UpgradeRequestDto>(`/workspaces/${workspaceId}/upgrade-requests`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: subscriptionKeys.overview(workspaceId) });
      void qc.invalidateQueries({ queryKey: ["workspace", workspaceId, "upgrade-requests"] });
    },
  });
}

export function useMyUpgradeRequests(workspaceId: string) {
  return useQuery({
    queryKey: ["workspace", workspaceId, "upgrade-requests"],
    queryFn: ({ signal }) =>
      api.get<UpgradeRequestDto[]>(
        `/workspaces/${workspaceId}/upgrade-requests`,
        undefined,
        signal,
      ),
  });
}

export function useCancelUpgrade(workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) =>
      api.delete<UpgradeRequestDto>(`/workspaces/${workspaceId}/upgrade-requests/${requestId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: subscriptionKeys.overview(workspaceId) });
      void qc.invalidateQueries({ queryKey: ["workspace", workspaceId, "upgrade-requests"] });
    },
  });
}

/** Creates the provider order for one billing period (organization owners and billing admins). */
export function useCreateCheckout(organizationId: string | null) {
  return useMutation({
    mutationFn: (body: CreateCheckoutInput) =>
      api.post<CheckoutSessionDto>(`/organizations/${organizationId}/checkout`, body),
  });
}

/** Confirms the checkout callback; the plan counts as paid only when `status` is ACTIVE. */
export function useVerifyCheckout(organizationId: string | null, workspaceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: VerifyCheckoutInput) =>
      api.post<CheckoutVerifyDto>(`/organizations/${organizationId}/checkout/verify`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: subscriptionKeys.overview(workspaceId) });
      void qc.invalidateQueries({ queryKey: ["workspace", workspaceId] });
    },
  });
}
