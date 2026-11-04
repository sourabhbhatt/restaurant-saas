"use client";

import { useQuery } from "@tanstack/react-query";

import type { KitchenFeedDto } from "@/contracts/staff-ops";
import { api } from "@/lib/api-client";
import { staffOpsKeys } from "@/features/orders/keys";

export function useKitchenFeed(branchId: string, refetchInterval: number) {
  return useQuery({
    queryKey: staffOpsKeys.kitchen(branchId),
    queryFn: ({ signal }) =>
      api.get<KitchenFeedDto>(`/branches/${branchId}/kitchen`, undefined, signal),
    refetchInterval,
    refetchIntervalInBackground: true,
  });
}
