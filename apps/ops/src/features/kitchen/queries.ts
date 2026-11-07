"use client";

import { useQuery } from "@tanstack/react-query";

import type { KitchenFeedDto } from "@ros/contracts/staff-ops";
import { api } from "@ros/api-client";
import { staffOpsKeys } from "@ros/web-core/features/orders/keys";

export function useKitchenFeed(branchId: string, refetchInterval: number) {
  return useQuery({
    queryKey: staffOpsKeys.kitchen(branchId),
    queryFn: ({ signal }) =>
      api.get<KitchenFeedDto>(`/branches/${branchId}/kitchen`, undefined, signal),
    refetchInterval,
    refetchIntervalInBackground: true,
    // Kept on this device so a reloaded kitchen screen still shows tickets offline.
    meta: { persist: true },
  });
}
